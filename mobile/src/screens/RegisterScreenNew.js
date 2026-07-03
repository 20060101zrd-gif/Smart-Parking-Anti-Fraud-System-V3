import React, { useState, useEffect } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, Alert,
  StyleSheet, Modal, KeyboardAvoidingView, Platform,
  StatusBar, ScrollView, Image
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { LinearGradient } from 'expo-linear-gradient'
import client from '../api/interceptors'
import { storage } from '../utils/secureStore'
import { navigate } from '../navigation/RootNavigation'
import SliderCaptcha from '../components/SliderCaptcha'

// Logo source outside component — prevents re-require flickering
const LOGO_SOURCE = require('../../assets/icon.jpg')

/**
 * ================================================================
 *  RegisterScreenNew — Redesigned Modern Login / Register Screen
 * ================================================================
 *  This is a redesigned version of RegisterScreen with modern UI:
 *  - Soft gradient background
 *  - Geometric app logo built with React Native Views
 *  - Card-based form with icon inputs
 *  - Gradient CTA button with shadow
 *  - Trust badge at bottom
 *
 *  Business logic is identical to the original RegisterScreen.
 *  To use: replace RegisterScreen import in your navigator with this file.
 * ================================================================
 */

export default function RegisterScreenNew() {
  const [phone, setPhone]         = useState('')
  const [name, setName]           = useState('')
  const [loading, setLoading]     = useState(false)
  const [showCaptcha, setShowCaptcha] = useState(false)

  // ── 进入页面先检查有没有已注册的用户 ─────────────────────
  useEffect(() => {
    const checkUser = async () => {
      const userInfo = await storage.getItem('user_info')
      if (userInfo?.hasCoupon) {
        navigate('HomeScreen')
      }
    }
    checkUser()
  }, [])

  // ── 执行注册（低风险路径） ────────────────────────────
  const doRegister = async (captchaToken = null) => {
    const endpoint = captchaToken ? '/user/verify-captcha' : '/user/register'
    const body = captchaToken
      ? { phone, name, captchaToken }
      : { phone, name }

    const res = await client.post(endpoint, body)
    return res.data
  }

  const handleRegisterSuccess = async (data) => {
    const { hasCoupon, isExisting } = data
    await storage.setItem('user_info', {
      phone,
      hasCoupon,
      isExisting: isExisting || false
    })
    navigate('HomeScreen')
    if (!isExisting) {
      Alert.alert('🎉 注册成功', '停车券已发放到您的账户')
    }
  }

  // ── 注册按钮点击 ──────────────────────────────────────
  const handleRegister = async () => {
    if (!phone || !name) {
      Alert.alert('提示', '请输入手机号和姓名')
      return
    }

    setLoading(true)
    try {
      const data = await doRegister()

      if (data.code === 20000) {
        await handleRegisterSuccess(data.data)
      }
    } catch (err) {
      const errCode = err.response?.data?.code
      const errMsg  = err.response?.data?.message
      // 403 风控拦截由 interceptor 跳转 RiskBlockScreen，不弹调试 Toast
      const isRiskBlock = errCode === 40300 || errCode === 40301 || errCode === 40302
      if (!isRiskBlock && !err.response) {
        console.log('[RegisterNew] 无响应：后端可能未启动或网络不通')
      }

      if (errCode === 40101) {
        setShowCaptcha(true)
      } else if (isRiskBlock) {
        console.log('[RegisterNew] 风控拦截, code:', errCode)
      } else if (errCode === 40029 || err.response?.status === 429) {
        Alert.alert('提示', '操作过于频繁，请稍后再试')
      } else {
        Alert.alert('错误', errMsg || '注册失败，请重试')
      }
    } finally {
      setLoading(false)
    }
  }

  // ── 验证码回调 ────────────────────────────────────────
  const handleCaptchaVerify = async (token) => {
    setShowCaptcha(false)
    setLoading(true)

    try {
      const data = await doRegister(token)

      if (data.code === 20000) {
        await handleRegisterSuccess(data.data)
      }
    } catch (err) {
      const errCode = err.response?.data?.code
      const errMsg  = err.response?.data?.message
      const isRiskBlock = errCode === 40300 || errCode === 40301 || errCode === 40302
      if (!isRiskBlock && !err.response) {
        console.log('[RegisterNew] 验证码注册异常：后端可能未启动或网络不通')
      }

      if (errCode === 40111) {
        Alert.alert('提示', '验证凭证已失效，请重新验证')
        setShowCaptcha(true)
      } else if (errCode === 40300 || errCode === 40301 || errCode === 40302) {
        console.log('[RegisterNew] 风控拦截, code:', errCode)
      } else {
        Alert.alert('错误', errMsg || '注册失败')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleCaptchaCancel = () => {
    setShowCaptcha(false)
  }

  // ── Render Helpers ────────────────────────────────────
  const PhoneIcon = () => (
    <View style={styles.iconContainer}>
      <View style={styles.phoneIconBody} />
      <View style={styles.phoneIconNotch} />
    </View>
  )

  const UserIcon = () => (
    <View style={styles.iconContainer}>
      <View style={styles.userIconHead} />
      <View style={styles.userIconBody} />
    </View>
  )

  const ShieldIcon = () => (
    <View style={styles.shieldIcon}>
      <View style={styles.shieldInner} />
    </View>
  )

  // ── Main Render ─────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor="#F0F9FF" />
      <LinearGradient
        colors={['#F0F9FF', '#E0F2FE', '#F8FAFC']}
        style={styles.gradientBg}
      >
        <KeyboardAvoidingView
          style={styles.keyboardAvoid}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* ── Logo Section ── */}
            <View style={styles.logoSection}>
              <Image source={LOGO_SOURCE} style={styles.logoIcon} />
              <Text style={styles.brandName}>停小券</Text>
              <Text style={styles.brandTagline}>免费停车券 · 一键领取</Text>
            </View>

            {/* ── Form Card ── */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>注册领券</Text>
              <Text style={styles.cardSubtitle}>首次注册即可领取免费停车券</Text>

              {/* Phone Input */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>手机号码</Text>
                <View style={styles.inputWrapper}>
                  <PhoneIcon />
                  <TextInput
                    style={styles.inputField}
                    placeholder="请输入手机号"
                    value={phone}
                    onChangeText={setPhone}
                    keyboardType="phone-pad"
                    maxLength={11}
                    placeholderTextColor="#CBD5E1"
                  />
                </View>
              </View>

              {/* Name Input */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>真实姓名</Text>
                <View style={styles.inputWrapper}>
                  <UserIcon />
                  <TextInput
                    style={styles.inputField}
                    placeholder="请输入姓名"
                    value={name}
                    onChangeText={setName}
                    placeholderTextColor="#CBD5E1"
                  />
                </View>
              </View>

              {/* Submit Button */}
              <TouchableOpacity
                style={[styles.submitBtn, loading && styles.submitBtnDisabled]}
                onPress={handleRegister}
                disabled={loading}
                activeOpacity={0.85}
              >
                <LinearGradient
                  colors={loading ? ['#93C5FD', '#93C5FD'] : ['#3B82F6', '#2563EB']}
                  style={styles.submitBtnGradient}
                >
                  <Text style={styles.submitBtnText}>
                    {loading ? '提交中...' : '注册领券'}
                  </Text>
                  {!loading && (
                    <Text style={styles.submitBtnArrow}>→</Text>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            </View>

            {/* ── Trust Badge ── */}
            <View style={styles.trustSection}>
              <ShieldIcon />
              <Text style={styles.trustText}>数据加密传输 · 隐私安全保护</Text>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </LinearGradient>

      {/* ── Captcha Modal ── */}
      <Modal
        visible={showCaptcha}
        transparent
        animationType="fade"
        onRequestClose={handleCaptchaCancel}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>🔐 安全验证</Text>
            <Text style={styles.modalSubtitle}>
              检测到异常注册频率，请完成滑动拼图验证
            </Text>

            <SliderCaptcha
              onVerify={handleCaptchaVerify}
              onCancel={handleCaptchaCancel}
            />

            <TouchableOpacity
              style={styles.modalCloseBtn}
              onPress={handleCaptchaCancel}
            >
              <Text style={styles.modalCloseText}>关闭</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

// ─── Styles ──────────────────────────────────────────────
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F0F9FF',
  },
  gradientBg: {
    flex: 1,
  },
  keyboardAvoid: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 60,
    paddingBottom: 32,
  },

  // ── Logo ──
  logoSection: {
    alignItems: 'center',
    marginBottom: 32,
  },
  logoIcon: {
    width: 88,
    height: 88,
    borderRadius: 26,
    marginBottom: 16,
  },
  brandName: {
    fontSize: 24,
    fontWeight: '700',
    color: '#0F172A',
    letterSpacing: 1,
    marginBottom: 4,
  },
  brandTagline: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '400',
  },

  // ── Card ──
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    paddingHorizontal: 22,
    paddingVertical: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 4,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 4,
  },
  cardSubtitle: {
    fontSize: 13,
    color: '#94A3B8',
    textAlign: 'center',
    marginBottom: 24,
  },

  // ── Inputs ──
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 6,
    paddingLeft: 4,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 50,
  },
  inputField: {
    flex: 1,
    fontSize: 16,
    color: '#0F172A',
    paddingVertical: 0,
    marginLeft: 10,
  },

  // ── Icons ──
  iconContainer: {
    width: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  phoneIconBody: {
    width: 14,
    height: 22,
    borderRadius: 3,
    borderWidth: 2,
    borderColor: '#94A3B8',
  },
  phoneIconNotch: {
    width: 6,
    height: 2,
    borderRadius: 1,
    backgroundColor: '#94A3B8',
    position: 'absolute',
    bottom: 2,
  },
  userIconHead: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#94A3B8',
    position: 'absolute',
    top: 2,
  },
  userIconBody: {
    width: 16,
    height: 8,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    borderWidth: 2,
    borderColor: '#94A3B8',
    borderBottomWidth: 0,
    position: 'absolute',
    bottom: 2,
  },

  // ── Button ──
  submitBtn: {
    borderRadius: 14,
    overflow: 'hidden',
    marginTop: 8,
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 6,
  },
  submitBtnDisabled: {
    shadowOpacity: 0.1,
    elevation: 1,
  },
  submitBtnGradient: {
    height: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  submitBtnText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
  submitBtnArrow: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    marginLeft: 4,
  },

  // ── Trust ──
  trustSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 'auto',
    paddingTop: 20,
  },
  shieldIcon: {
    width: 14,
    height: 16,
    borderWidth: 1.5,
    borderColor: '#10B981',
    borderRadius: 2,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  shieldInner: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
    marginTop: -2,
  },
  trustText: {
    fontSize: 12,
    color: '#94A3B8',
  },

  // ── Modal ──
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 10,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1f2937',
    marginBottom: 4,
  },
  modalSubtitle: {
    fontSize: 13,
    color: '#6b7280',
    marginBottom: 12,
    textAlign: 'center',
  },
  modalCloseBtn: {
    marginTop: 8,
    paddingVertical: 8,
  },
  modalCloseText: {
    color: '#9ca3af',
    fontSize: 14,
  },
})
