// mobile/src/components/SliderCaptcha.js
// 滑动拼图人机验证组件 — React Native + PanResponder
// 对接后端 GET /captcha/generate + POST /captcha/verify

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, Animated, PanResponder, StyleSheet,
  ActivityIndicator, Dimensions
} from 'react-native';
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
const PUZZLE_W_SCALED = PUZZLE_W * scale;
const PUZZLE_H_SCALED = PUZZLE_H * scale;
const SLIDER_MAX_SCALED = CANVAS_SCALED - PUZZLE_W_SCALED;
const THUMB_W = 46;

export default function SliderCaptcha({ onVerify, onCancel }) {
  // ── 状态 ──────────────────────────────────────────
  const [captchaId, setCaptchaId]  = useState(null);
  const [gapX, setGapX]            = useState(0);
  const [gapY, setGapY]            = useState(0);
  const [loading, setLoading]      = useState(true);
  const [verifying, setVerifying]  = useState(false);
  const [status, setStatus]        = useState('idle');   // idle | dragging | verifying | success | fail | expired
  const [statusMsg, setStatusMsg]  = useState('加载验证码中...');
  const [countdown, setCountdown]  = useState(60);

  // 用 ref 保存最新状态，避免 PanResponder 闭包过期
  const statusRef     = useRef('idle');
  const verifyingRef  = useRef(false);
  const countdownRef  = useRef(null);
  const captchaIdRef  = useRef(null);
  const gapXRef       = useRef(0);
  const onVerifyRef   = useRef(onVerify);

  useEffect(() => { statusRef.current = status; }, [status]);
  useEffect(() => { verifyingRef.current = verifying; }, [verifying]);
  useEffect(() => { captchaIdRef.current = captchaId; }, [captchaId]);
  useEffect(() => { gapXRef.current = gapX; }, [gapX]);
  useEffect(() => { onVerifyRef.current = onVerify; }, [onVerify]);

  // 滑块位置（拼图块与下方滑块 thumb 共用）
  const sliderX = useRef(new Animated.Value(0)).current;

  // ── 获取验证码 ────────────────────────────────────
  const fetchCaptcha = useCallback(async () => {
    setLoading(true);
    setStatus('idle');
    setStatusMsg('加载验证码中...');
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
        setGapX(d.puzzle.x * scale);
        setGapY(d.puzzle.y * scale);
        setStatusMsg('拖动下方滑块使拼图对准缺口');
        setCountdown(d.expiresIn);

        // 倒计时
        let remaining = d.expiresIn;
        countdownRef.current = setInterval(() => {
          remaining -= 1;
          setCountdown(remaining);
          if (remaining <= 0) {
            clearInterval(countdownRef.current);
            setStatus('expired');
            setStatusMsg('验证码已过期，正在刷新...');
            setTimeout(fetchCaptcha, 800);
          }
        }, 1000);
      } else {
        setStatusMsg('验证码加载失败');
      }
    } catch {
      setStatusMsg('网络异常，验证码加载失败');
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
    setStatusMsg(`❌ 验证失败，剩余 ${remain} 次机会，自动刷新中...`);

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
    const currentGapX = gapXRef.current;
    if (!currentCaptchaId || verifyingRef.current || statusRef.current === 'success' || statusRef.current === 'fail') return;

    setVerifying(true);
    setStatus('verifying');
    setStatusMsg('校验中...');

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
        setStatusMsg('✅ 验证通过');
        // 回弹到缺口位置
        Animated.spring(sliderX, {
          toValue: currentGapX,
          useNativeDriver: false,
          friction: 8
        }).start();
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
        setStatusMsg('拖动中...');
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
    status === 'success' ? '✅ 验证通过' :
    status === 'fail'    ? '❌ 验证失败' :
    status === 'dragging' ? '...' :
    '→ 拖动滑块到缺口位置 →';

  // ── 渲染 ──────────────────────────────────────────
  return (
    <View style={styles.wrapper}>
      {/* 画布区域 */}
      <View style={[styles.canvas, { width: CANVAS_SCALED + 4 }]}>
        {/* 背景 */}
        <View style={[styles.canvasBg, { width: CANVAS_SCALED }]}>
          <Text style={styles.canvasLabel}>滑动拼图验证</Text>
          {/* 缺口标记 */}
          <View style={[styles.gap, {
            left:   gapX,
            top:    gapY,
            width:  PUZZLE_W_SCALED,
            height: PUZZLE_H_SCALED
          }]} />
        </View>

        {/* 可拖动的拼图块（跟随下方滑块） */}
        <Animated.View
          style={[
            styles.puzzlePiece,
            {
              top:    gapY,
              width:  PUZZLE_W_SCALED,
              height: PUZZLE_H_SCALED,
              transform: [{ translateX: sliderX }]
            }
          ]}
        >
          <Text style={styles.puzzleIcon}>🧩</Text>
        </Animated.View>
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
        {loading && <ActivityIndicator size="small" color="#2563eb" />}
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
          🔄 刷新验证码
        </Text>
        {onCancel && (
          <Text style={styles.cancelBtn} onPress={onCancel}>
            取消
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

  // 画布
  canvas: {
    height: CANVAS_H * scale + 4,
    borderWidth: 2,
    borderColor: '#d1d5db',
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#f9fafb',
  },
  canvasBg: {
    flex: 1,
    backgroundColor: '#e5e7eb',
    justifyContent: 'center',
    alignItems: 'center',
  },
  canvasLabel: {
    color: '#9ca3af',
    fontSize: 13,
    letterSpacing: 4,
  },

  // 缺口
  gap: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: '#6366f1',
    borderStyle: 'dashed',
    borderRadius: 4,
    backgroundColor: 'rgba(99,102,241,0.08)',
  },

  // 拼图块（跟随滑块）
  puzzlePiece: {
    position: 'absolute',
    left: 0,
    backgroundColor: '#6366f1',
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 5,
    borderWidth: 2,
    borderColor: '#4f46e5',
  },
  puzzleIcon: {
    fontSize: 20,
  },

  // 滑轨
  track: {
    height: 46,
    marginTop: 12,
    borderRadius: 23,
    backgroundColor: '#e5e7eb',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  trackProgress: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(99,102,241,0.25)',
  },
  trackHint: {
    fontSize: 12,
    color: '#9ca3af',
    textAlign: 'center',
    zIndex: 1,
  },

  // 滑块 thumb
  thumb: {
    position: 'absolute',
    left: 0,
    top: 0,
    backgroundColor: '#6366f1',
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

  // 状态
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
    color: '#6b7280',
  },
  statusSuccess: { color: '#16a34a', fontWeight: '600' },
  statusFail:    { color: '#dc2626', fontWeight: '600' },
  countdown: {
    fontSize: 12,
    color: '#f59e0b',
    fontWeight: '600',
  },

  // 操作
  actions: {
    flexDirection: 'row',
    marginTop: 6,
    gap: 24,
  },
  refreshBtn: {
    color: '#2563eb',
    fontSize: 13,
  },
  cancelBtn: {
    color: '#9ca3af',
    fontSize: 13,
  },
});
