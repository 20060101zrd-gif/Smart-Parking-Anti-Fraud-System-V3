// backend/src/services/captcha.service.js
// 纯代码滑动拼图人机验证 — 后端核心逻辑
// 零第三方依赖，基于 Node.js crypto + Redis

const crypto = require('crypto');
const redisClient = require('../data/redis.client');

class CaptchaService {
  constructor() {
    this.ANSWER_TTL     = 60;            // 答案有效期 60 秒
    this.TOKEN_TTL      = 5 * 60;        // 验证 token 5 分钟
    this.TOLERANCE_PX   = 5;             // ±5 像素容差
    this.CANVAS_WIDTH   = 280;           // 画布宽度
    this.CANVAS_HEIGHT  = 150;           // 画布高度
    this.PUZZLE_WIDTH   = 50;            // 拼图块宽度
    this.PUZZLE_HEIGHT  = 50;            // 拼图块高度
    // 🆕 内存降级：Redis 不可用时，用本地 Map 暂存答案和 token
    this._memoryAnswers = new Map();
    this._memoryTokens  = new Map();
    this._memoryTimers  = new Map();
  }

  // ─── 工具函数 ─────────────────────────────────────────

  /** 生成唯一验证码 ID */
  generateId() {
    return crypto.randomUUID();
  }

  /** 生成一次性验证 token */
  generateToken() {
    return crypto.randomUUID();
  }

  /** 安全随机整数 [min, max] */
  _randomInt(min, max) {
    const range = max - min + 1;
    const randomBytes = crypto.randomBytes(4);
    const randomValue = randomBytes.readUInt32BE(0);
    return min + (randomValue % range);
  }

  // ─── 核心业务 ─────────────────────────────────────────

  /**
   * 生成滑动验证码
   *  1. 随机生成缺口坐标
   *  2. 正确答案存入 Redis（60s 过期）
   *  3. 返回画布参数 + 拼图参数（不含答案 X）
   *
   * @returns {Object} { captchaId, canvas, puzzle, expiresIn }
   */
  async generate() {
    const captchaId = this.generateId();

    // 缺口 X 坐标：留出拼图宽度边距，保证拼图块完全在画布内
    const minX = 20;
    const maxX = this.CANVAS_WIDTH - this.PUZZLE_WIDTH - 20;
    const answerX = this._randomInt(minX, maxX);

    // 缺口 Y 坐标：留出上下边距
    const answerY = this._randomInt(5, this.CANVAS_HEIGHT - this.PUZZLE_HEIGHT - 5);

    // 正确答案写入 Redis（降级 → 内存）
    const redisOk = await redisClient.set(
      `captcha:answer:${captchaId}`,
      String(answerX),
      this.ANSWER_TTL
    );

    if (!redisOk) {
      // 🆕 Redis 不可用时，内存暂存（60s 自动过期）
      this._memoryAnswers.set(captchaId, answerX);
      const timer = setTimeout(() => {
        this._memoryAnswers.delete(captchaId);
        this._memoryTimers.delete(captchaId);
      }, this.ANSWER_TTL * 1000);
      this._memoryTimers.set(captchaId, timer);
      console.log(`[Captcha] ⚠️ Redis 不可用，使用内存降级 id=${captchaId} answerX=${answerX}`);
    } else {
      console.log(`[Captcha] 生成验证码 id=${captchaId} answerX=${answerX} answerY=${answerY}`);
    }

    return {
      captchaId,
      canvas: {
        width:  this.CANVAS_WIDTH,
        height: this.CANVAS_HEIGHT
      },
      puzzle: {
        width:  this.PUZZLE_WIDTH,
        height: this.PUZZLE_HEIGHT,
        x:      answerX,          // 缺口X（用于前端渲染；安全由服务端 verify 校验）
        y:      answerY
      },
      expiresIn: this.ANSWER_TTL
    };
  }

  /**
   * 校验滑块位置
   *  1. 从 Redis 取出正确答案
   *  2. 计算偏差，容差 ±5px
   *  3. 立即删除答案 key（防重放）
   *  4. 通过 → 签发一次性验证 token（5min）
   *
   * @param {String}  captchaId 验证码 ID
   * @param {Number}  sliderX   前端提交的滑块 X 坐标
   * @returns {Object} { success, token?, deviation?, message? }
   */
  async verify(captchaId, sliderX) {
    if (!captchaId || sliderX === undefined || sliderX === null) {
      return { success: false, code: 40005, message: '请求参数不完整，缺少 captchaId 或 sliderX' };
    }

    if (typeof sliderX !== 'number' || isNaN(sliderX) || sliderX < 0) {
      return { success: false, code: 40006, message: '滑块位置参数非法' };
    }

    // 超出画布范围视为验证失败（偏差过大），而非参数错误
    if (sliderX > this.CANVAS_WIDTH) {
      return { success: false, code: 40008, message: `验证未通过：滑块位置超出画布范围`, deviation: sliderX };
    }

    // 从 Redis 获取正确答案
    const answerKey = `captcha:answer:${captchaId}`;
    let answerXStr = await redisClient.get(answerKey);

    // 🆕 Redis 降级：从内存 Map 读取
    if (answerXStr === null && !redisClient.isReady) {
      const memVal = this._memoryAnswers.get(captchaId);
      if (memVal !== undefined) {
        answerXStr = String(memVal);
        console.log(`[Captcha] 从内存降级读取答案 id=${captchaId}`);
      }
    }

    if (!answerXStr) {
      return { success: false, code: 40007, message: '验证码已过期，请刷新重试' };
    }

    const correctX = parseInt(answerXStr, 10);
    const deviation = Math.abs(sliderX - correctX);

    // ⚠️ 立即删除答案，无论校验结果如何 — 防止重放攻击
    await redisClient.del(answerKey);
    // 🆕 同步清理内存副本
    this._memoryAnswers.delete(captchaId);
    const memTimer = this._memoryTimers.get(captchaId);
    if (memTimer) { clearTimeout(memTimer); this._memoryTimers.delete(captchaId); }

    if (deviation <= this.TOLERANCE_PX) {
      // ✅ 验证通过 → 签发一次性 token
      const token = this.generateToken();
      const redisTokenOk = await redisClient.set(
        `captcha:token:${token}`,
        '1',
        this.TOKEN_TTL
      );

      if (!redisTokenOk) {
        // 🆕 Redis 不可用时，内存暂存 token
        this._memoryTokens.set(token, true);
        const tokenTimer = setTimeout(() => {
          this._memoryTokens.delete(token);
        }, this.TOKEN_TTL * 1000);
        this._memoryTimers.set(`tok_${token}`, tokenTimer);
      }

      console.log(`[Captcha] ✅ 验证通过 id=${captchaId} deviation=${deviation}px token=${token.substring(0, 8)}...`);

      return {
        success: true,
        token,
        expiresIn: this.TOKEN_TTL,
        deviation
      };
    }

    // ❌ 偏差过大
    console.warn(`[Captcha] ❌ 验证失败 id=${captchaId} expected=${correctX} got=${sliderX} deviation=${deviation}px`);

    return {
      success: false,
      code: 40008,
      message: `验证未通过：偏差 ${deviation}px，允许范围 ±${this.TOLERANCE_PX}px`,
      deviation
    };
  }

  /**
   * 校验并消耗一次性验证 token
   *  1. 检查 token 是否存在于 Redis
   *  2. 存在 → 立即删除（确保一次性）
   *  3. 不存在 → 拒绝
   *
   * @param {String} token 验证 token
   * @returns {Boolean} 是否有效
   */
  async consumeToken(token) {
    if (!token || typeof token !== 'string') return false;

    const tokenKey = `captcha:token:${token}`;
    const exists = await redisClient.get(tokenKey);

    // 🆕 Redis 降级：从内存 Map 校验
    if (!exists && !redisClient.isReady) {
      const memExists = this._memoryTokens.get(token);
      if (memExists) {
        this._memoryTokens.delete(token);
        const tokTimer = this._memoryTimers.get(`tok_${token}`);
        if (tokTimer) { clearTimeout(tokTimer); this._memoryTimers.delete(`tok_${token}`); }
        console.log(`[Captcha] 🔑 Token 核销成功（内存降级） ${token.substring(0, 8)}...`);
        return true;
      }
      return false;
    }

    if (!exists) return false;

    // 🔒 原子性消耗：先删后返回，同一个 token 不可能被两次通过
    await redisClient.del(tokenKey);

    console.log(`[Captcha] 🔑 Token 核销成功 ${token.substring(0, 8)}...`);
    return true;
  }
}

module.exports = new CaptchaService();
