// backend/src/services/captcha.service.js
// 纯代码滑动拼图人机验证 — 后端核心逻辑
// 零第三方依赖，基于 Node.js crypto + Redis
// 🆕 v2: 服务端生成 SVG 图片，answerX 不返回给前端，真正防刷

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

  /**
   * 🆕 根据种子生成随机噪声点（deterministic per captchaId）
   */
  _generateNoise(seed, count, maxX, maxY) {
    const hash = crypto.createHash('sha256').update(seed).digest('hex');
    let noise = '';
    for (let i = 0; i < count; i++) {
      const cx = parseInt(hash.substring(i * 6, i * 6 + 3), 16) % maxX;
      const cy = parseInt(hash.substring(i * 6 + 3, i * 6 + 6), 16) % maxY;
      const r = (parseInt(hash.charAt(i % 64), 16) % 3) + 2;
      const shade = parseInt(hash.substring((i * 2) % 56, (i * 2) % 56 + 2), 16) % 50 + 180;
      noise += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="rgb(${shade},${shade+5},${shade+10})" opacity="0.7"/>`;
    }
    return noise;
  }

  /**
   * 🆕 生成背景 SVG（含缺口）
   * answerX/answerY 仅用于渲染缺口位，不会返回给前端
   */
  _generateBackgroundSvg(captchaId, answerX, answerY) {
    const pattern = this._generatePattern(captchaId, 0, 0, this.CANVAS_WIDTH, this.CANVAS_HEIGHT);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${this.CANVAS_WIDTH}" height="${this.CANVAS_HEIGHT}">
  <rect width="${this.CANVAS_WIDTH}" height="${this.CANVAS_HEIGHT}" fill="#e2e8f0"/>
  ${pattern}
  <text x="${Math.floor(this.CANVAS_WIDTH / 2)}" y="18" text-anchor="middle" fill="#94a3b8" font-size="10" font-family="sans-serif">滑动拼图验证</text>
  <!-- 缺口：白色镂空 + 虚线边框 -->
  <rect x="${answerX}" y="${answerY}" width="${this.PUZZLE_WIDTH}" height="${this.PUZZLE_HEIGHT}" fill="#f8fafc" stroke="#6366f1" stroke-width="2" stroke-dasharray="4,3" rx="4"/>
</svg>`;
  }

  /**
   * 🆕 生成拼图块 SVG（与缺口位背景图案一致，对齐后融为一体）
   */
  _generatePuzzleSvg(captchaId, answerX, answerY) {
    const pattern = this._generatePattern(captchaId, answerX, answerY, this.PUZZLE_WIDTH, this.PUZZLE_HEIGHT);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${this.PUZZLE_WIDTH}" height="${this.PUZZLE_HEIGHT}">
  ${pattern}
  <!-- 边框与缺口虚线一致，对齐后融为一体 -->
  <rect x="0" y="0" width="${this.PUZZLE_WIDTH}" height="${this.PUZZLE_HEIGHT}" fill="none" stroke="#6366f1" stroke-width="2" stroke-dasharray="4,3" rx="4"/>
</svg>`;
  }

  /**
   * 🆕 生成确定性背景图案（背景与拼图块共享同一算法）
   */
  _generatePattern(captchaId, x, y, width, height) {
    const hash = crypto.createHash('sha256').update(captchaId).digest('hex');
    const cellSize = 20;   // 20px 网格，14×8=112 个色块，轻量不卡
    const cols = Math.ceil(this.CANVAS_WIDTH / cellSize);
    let shapes = '';

    // 网格色块（与缺口位置完全匹配）
    for (let gy = Math.floor(y / cellSize); gy <= Math.floor((y + height) / cellSize); gy++) {
      for (let gx = Math.floor(x / cellSize); gx <= Math.floor((x + width) / cellSize); gx++) {
        const cx = gx * cellSize;
        const cy = gy * cellSize;
        const rx = Math.max(x - cx, 0);
        const ry = Math.max(y - cy, 0);
        const rw = Math.min(cellSize - rx, x + width - cx - rx);
        const rh = Math.min(cellSize - ry, y + height - cy - ry);
        if (rw <= 0 || rh <= 0) continue;

        const idx = ((gy * cols + gx) * 2) % 64;
        const shade = parseInt(hash.substr(idx, 2), 16) % 40 + 200;
        const lx = cx + rx - x;
        const ly = cy + ry - y;
        shapes += `<rect x="${lx}" y="${ly}" width="${rw}" height="${rh}" fill="rgb(${shade},${shade+5},${shade+10})"/>`;
      }
    }

    // 随机噪声点（与缺口位置完全匹配）
    for (let i = 0; i < 15; i++) {
      const cx = parseInt(hash.substr(i * 4, 3), 16) % this.CANVAS_WIDTH;
      const cy = parseInt(hash.substr(i * 4 + 3, 3), 16) % this.CANVAS_HEIGHT;
      const r = (parseInt(hash.charAt(i * 2), 16) % 3) + 2;
      if (cx >= x && cx < x + width && cy >= y && cy < y + height) {
        const shade = parseInt(hash.substr((i * 2 + 32) % 64, 2), 16) % 50 + 160;
        shapes += `<circle cx="${cx - x}" cy="${cy - y}" r="${r}" fill="rgb(${shade},${shade+5},${shade+10})" opacity="0.7"/>`;
      }
    }

    return shapes;
  }

  // ─── 核心业务 ─────────────────────────────────────────

  /**
   * 🆕 v2 生成滑动验证码
   *  1. 随机生成缺口坐标（answerX 仅存 Redis，不返回前端）
   *  2. 服务端生成背景 SVG + 拼图块 SVG
   *  3. 前端只需渲染两张图片，用户手动拖拽对齐
   *
   * @returns {Object} { captchaId, backgroundSvg, puzzleSvg, canvas, puzzle, puzzleY, expiresIn }
   */
  async generate() {
    const captchaId = this.generateId();

    // 缺口 X 坐标：留出拼图宽度边距，保证拼图块完全在画布内
    const minX = 20;
    const maxX = this.CANVAS_WIDTH - this.PUZZLE_WIDTH - 20;
    const answerX = this._randomInt(minX, maxX);

    // 缺口 Y 坐标：留出上下边距
    const answerY = this._randomInt(10, this.CANVAS_HEIGHT - this.PUZZLE_HEIGHT - 10);

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

    // 🆕 服务端生成 SVG 图片（前端无法从 SVG 中提取精确坐标）
    const backgroundSvg = this._generateBackgroundSvg(captchaId, answerX, answerY);
    const puzzleSvg = this._generatePuzzleSvg(captchaId, answerX, answerY);

    return {
      captchaId,
      backgroundSvg,
      puzzleSvg,
      canvas: {
        width:  this.CANVAS_WIDTH,
        height: this.CANVAS_HEIGHT
      },
      puzzle: {
        width:  this.PUZZLE_WIDTH,
        height: this.PUZZLE_HEIGHT
      },
      puzzleY: answerY,   // Y 坐标不涉及滑动校验，仅用于前端垂直定位拼图块
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
