// mobile/src/components/SliderCaptcha.js
// 🆕 v2: 服务端生成 SVG 拼图图片，前端只负责渲染和拖拽
// answerX 完全不返回前端，真正杜绝自动答题
// 对接后端 GET /captcha/generate + POST /captcha/verify

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, Animated, PanResponder, StyleSheet,
  ActivityIndicator, Dimensions
} from 'react-native';
import { SvgXml } from 'react-native-svg';
import client from '../api/clients';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// 后端约定常量
const CANVAS_W = 280;
const CANVAS_H = 150;
const PUZZLE_W = 50;
const PUZZLE_H = 50;

// 按屏幕宽度等比例缩放
const scale = Math.min(1, (SCREEN_WIDTH - 48) / CANVAS_W);
const CANVAS_SCALED  = CANVAS_W * scale;
const CANVAS_H_SCALED = CANVAS_H * scale;
const PUZZLE_W_SCALED = PUZZLE_W * scale;
const PUZZLE_H_SCALED = PUZZLE_H * scale;
const SLIDER_MAX_SCALED = CANVAS_SCALED - PUZZLE_W_SCALED;
const THUMB_W = 46;

export default function SliderCaptcha({ onVerify, onCancel }) {
  // ── 状态 ──────────────────────────────────────────
  const [captchaId, setCaptchaId]   = useState(null);
  const [backgroundSvg, setBgSvg]   = useState('');
  const [puzzleSvg, setPzSvg]       = useState('');
  const [puzzleY, setPuzzleY]       = useState(0);
  const [loading, setLoading]       = useState(true);
  const [verifying, setVerifying]   = useState(false);
  const [status, setStatus]         = useState('idle');
  const [statusMsg, setStatusMsg]   = useState('加载验证码中...');
  const [countdown, setCountdown]   = useState(60);

  // 用 ref 保存最新状态，避免 PanResponder 闭包过期
  const statusRef     = useRef('idle');
  const verifyingRef  = useRef(false);
  const countdownRef  = useRef(null);
  const captchaIdRef  = useRef(null);
  const onVerifyRef   = useRef(onVerify);

  useEffect(() => { statusRef.current = status; }, [status]);
  useEffect(() => { verifyingRef.current = verifying; }, [verifying]);
  useEffect(() => { captchaIdRef.current = captchaId; }, [captchaId]);
  useEffect(() => { onVerifyRef.current = onVerify; }, [onVerify]);

  // 滑块位置（拼图块与下方滑块 thumb 共用）
  const sliderX = useRef(new Animated.Value(0)).current;

  // ── 获取验证码（🆕 接收 backgroundSvg + puzzleSvg）────
  const fetchCaptcha = useCallback(async () => {
    setLoading(true);
    setStatus('idle');
    setStatusMsg('Loading captcha...');
    setVerifying(false);

    // 复位滑块
    sliderX.setValue(0);

    // 清除旧倒计时
    if (countdownRef.current) clearInterval(countdownRef.current);

    try {
      const res = await client.get('/captcha/generate');
      if (res.data?.code === 20000) {
        const d = res.data.data;
        setCaptchaId(d.captchaId);
        setBgSvg(d.backgroundSvg);
        setPzSvg(d.puzzleSvg);
        setPuzzleY((d.puzzleY || 50) * scale);
        setStatusMsg('Drag slider to align puzzle piece');
        setCountdown(d.expiresIn);

        // 倒计时
        let remaining = d.expiresIn;
        countdownRef.current = setInterval(() => {
          remaining -= 1;
          setCountdown(remaining);
          if (remaining <= 0) {
            clearInterval(countdownRef.current);
            setStatus('expired');
            setStatusMsg('Captcha expired. Refreshing...');
            setTimeout(fetchCaptcha, 800);
          }
        }, 1000);
      } else {
        setStatusMsg('Captcha failed to load');
      }
    } catch {
      setStatusMsg('Network error. Captcha failed to load');
    } finally {
      setLoading(false);
    }
  }, [sliderX]);

  useEffect(() => {
    fetchCaptcha();
    return () => { if (countdownRef.current) clearInterval(countdownRef.current); };
  }, [fetchCaptcha]);

  // ── 滑块位置提交校验 ──────────────────────────────
  const handleFail = useCallback((failCount) => {
    setStatus('fail');
    const remain = failCount != null ? Math.max(0, 3 - failCount) : '?';
    setStatusMsg(`Failed. ${remain} attempt(s) remaining. Refreshing...`);

    // 弹回起点
    Animated.spring(sliderX, {
      toValue: 0,
      useNativeDriver: false,
      friction: 8
    }).start();

    setTimeout(fetchCaptcha, 1200);
  }, [fetchCaptcha, sliderX]);

  const verifyPosition = useCallback(async (xScaled) => {
    const currentCaptchaId = captchaIdRef.current;
    if (!currentCaptchaId || verifyingRef.current ||
        statusRef.current === 'success' || statusRef.current === 'fail') return;

    setVerifying(true);
    setStatus('verifying');
    setStatusMsg('Verifying...');

    // 缩放回后端坐标
    const serverX = Math.round(xScaled / scale);
    if (countdownRef.current) clearInterval(countdownRef.current);

    try {
      const res = await client.post('/captcha/verify', {
        captchaId: currentCaptchaId,
        sliderX: serverX
      });

      if (res.data?.code === 20000) {
        // ✅ 验证通过
        setStatus('success');
        setStatusMsg('Verified');
        // 停留在当前位置
        // 回调 token
        setTimeout(() => onVerifyRef.current && onVerifyRef.current(res.data.data.token), 600);
      } else {
        // ❌ 失败
        handleFail(res.data?.data?.failCount);
      }
    } catch (err) {
      const failCount = err.response?.data?.data?.failCount;
      handleFail(failCount);
    }
  }, [sliderX, handleFail]);

  // ── 拖拽手势（作用在滑块 thumb 上）──────────────────
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => {
        return !verifyingRef.current && statusRef.current !== 'success' && statusRef.current !== 'fail';
      },
      onMoveShouldSetPanResponder: () => {
        return !verifyingRef.current && statusRef.current !== 'success' && statusRef.current !== 'fail';
      },

      onPanResponderGrant: () => {
      setStatus('dragging');
      setStatusMsg('Dragging...');
      },

      onPanResponderMove: (_, g) => {
        const next = Math.max(0, Math.min(g.dx, SLIDER_MAX_SCALED));
        sliderX.setValue(next);
      },

      onPanResponderRelease: (_, g) => {
        const final = Math.max(0, Math.min(g.dx, SLIDER_MAX_SCALED));
        sliderX.setValue(final);
        verifyPosition(final);
      }
    })
  ).current;

  // 进度条宽度跟随 sliderX
  const progressWidth = sliderX.interpolate({
    inputRange: [0, SLIDER_MAX_SCALED],
    outputRange: ['0%', '100%'],
    extrapolate: 'clamp'
  });

  const trackLabel =
    status === 'success' ? 'Verified' :
    status === 'fail'    ? 'Failed' :
    status === 'dragging' ? '...' :
    'Drag slider to align puzzle piece';

  // ── 渲染 ──────────────────────────────────────────
  return (
    <View style={styles.wrapper}>
      {/* 🆕 画布区域 — 服务端 SVG 背景（含缺口） */}
      <View style={[styles.canvas, { width: CANVAS_SCALED + 4 }]}>
        <View style={[styles.canvasSvgArea, { width: CANVAS_SCALED, height: CANVAS_H_SCALED }]}>
          {backgroundSvg ? (
            <SvgXml xml={backgroundSvg} width={CANVAS_SCALED} height={CANVAS_H_SCALED} />
          ) : (
            <View style={styles.canvasPlaceholder}>
              <Text style={styles.canvasLabel}>加载中...</Text>
            </View>
          )}
        </View>

        {/* 🆕 可拖动的拼图块（SvgXml 渲染，跟随滑块） */}
        {puzzleSvg ? (
          <Animated.View
            style={[
              styles.puzzleWrapper,
              {
                top:    puzzleY,
                width:  PUZZLE_W_SCALED,
                height: PUZZLE_H_SCALED,
                transform: [{ translateX: sliderX }]
              }
            ]}
          >
            <SvgXml xml={puzzleSvg} width={PUZZLE_W_SCALED} height={PUZZLE_H_SCALED} />
          </Animated.View>
        ) : null}
      </View>

      {/* 滑轨 + 进度 + thumb */}
      <View style={[styles.track, { width: CANVAS_SCALED }]}>
        <Animated.View style={[styles.trackProgress, { width: progressWidth }]} />
        <Text style={styles.trackHint}>{trackLabel}</Text>

        <Animated.View
          {...panResponder.panHandlers}
          style={[
            styles.thumb,
            {
              width: THUMB_W,
              height: THUMB_W,
              borderRadius: THUMB_W / 2,
              transform: [{ translateX: sliderX }]
            }
          ]}
        >
          <Text style={styles.thumbIcon}>➜</Text>
        </Animated.View>
      </View>

      {/* 状态栏 */}
      <View style={styles.statusBar}>
        {loading && <ActivityIndicator size="small" color="#0070F3" />}
        <Text style={[
          styles.statusText,
          status === 'success' && styles.statusSuccess,
          status === 'fail'    && styles.statusFail,
          status === 'expired' && styles.statusFail,
        ]}>
          {statusMsg}
        </Text>
        {countdown > 0 && status === 'idle' && (
          <Text style={styles.countdown}>{countdown}s</Text>
        )}
      </View>

      {/* 操作按钮 */}
      <View style={styles.actions}>
        <Text style={styles.refreshBtn} onPress={fetchCaptcha}>
          Refresh Captcha
        </Text>
        {onCancel && (
          <Text style={styles.cancelBtn} onPress={onCancel}>
            Cancel
          </Text>
        )}
      </View>
    </View>
  );
}

// ─── 样式 ────────────────────────────────────────────
const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    paddingVertical: 12,
  },

  // Canvas
  canvas: {
    height: CANVAS_H * scale + 4,
    borderWidth: 1,
    borderColor: '#333333',
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#2A2A2A',
  },
  canvasSvgArea: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  canvasPlaceholder: {
    flex: 1,
    backgroundColor: '#2A2A2A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  canvasLabel: {
    color: '#666666',
    fontSize: 13,
    letterSpacing: 4,
  },

  // Puzzle piece wrapper
  puzzleWrapper: {
    position: 'absolute',
    left: 0,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
    elevation: 6,
  },

  // Track
  track: {
    height: 46,
    marginTop: 12,
    borderRadius: 100,
    backgroundColor: '#333333',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  trackProgress: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,112,243,0.2)',
  },
  trackHint: {
    fontSize: 12,
    color: '#666666',
    textAlign: 'center',
    zIndex: 1,
  },

  // Thumb
  thumb: {
    position: 'absolute',
    left: 0,
    top: 0,
    backgroundColor: '#0070F3',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 5,
    zIndex: 2,
  },
  thumbIcon: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },

  // Status
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
    height: 24,
    gap: 6,
  },
  statusText: {
    fontSize: 13,
    color: '#888888',
  },
  statusSuccess: { color: '#50e3c2', fontWeight: '600' },
  statusFail:    { color: '#ee0000', fontWeight: '600' },
  countdown: {
    fontSize: 12,
    color: '#f5a623',
    fontWeight: '600',
  },

  // Actions
  actions: {
    flexDirection: 'row',
    marginTop: 6,
    gap: 24,
  },
  refreshBtn: {
    color: '#0070F3',
    fontSize: 13,
  },
  cancelBtn: {
    color: '#666666',
    fontSize: 13,
  },
});
