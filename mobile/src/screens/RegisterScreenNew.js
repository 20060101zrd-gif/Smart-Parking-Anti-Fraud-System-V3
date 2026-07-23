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
import { getDeviceId } from '../utils/deviceId'
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
    const deviceId = await getDeviceId()
    const body = captchaToken
      ? { phone, name, captchaToken, deviceId }
      : { phone, name, deviceId }

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
      Alert.alert('Registration Complete', 'Parking coupon issued to your account')
    }
  }

  // ── 注册按钮点击 ──────────────────────────────────────
  const handleRegister = async () => {
    if (!phone || !name) {
      Alert.alert('Required', 'Please enter phone number and name')
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
        Alert.alert('Rate Limited', 'Too many attempts. Please wait.')
      } else {
        Alert.alert('Error', errMsg || 'Registration failed. Please try again.')
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
        Alert.alert('Expired', 'Verification token expired. Please try again.')
        setShowCaptcha(true)
      } else if (errCode === 40300 || errCode === 40301 || errCode === 40302) {
        console.log('[RegisterNew] Risk blocked, code:', errCode)
      } else {
        Alert.alert('Error', errMsg || 'Registration failed')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleCaptchaCancel = () => {
    // 验证码不可跳过，不做任何操作
    // 用户只能完成滑块验证或等待过期
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
      <StatusBar barStyle="light-content" backgroundColor="#171717" />
      <LinearGradient
        colors={['#171717', '#171717', '#171717']}
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

      {/* ── Captcha Modal (Android 返回键不可关闭) ── */}
      <Modal
        visible={showCaptcha}
        transparent
        animationType="fade"
        onRequestClose={() => {}}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Security Verification</Text>
            <Text style={styles.modalSubtitle}>
              Suspicious activity detected. Complete the slider puzzle.
            </Text>

            <SliderCaptcha
              onVerify={handleCaptchaVerify}
            />
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
    backgroundColor: '#171717',
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
    width: 64,
    height: 64,
    borderRadius: 8,
    marginBottom: 16,
  },
  brandName: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FAFAFA',
    letterSpacing: -0.6,
    marginBottom: 4,
  },
  brandTagline: {
    fontSize: 13,
    color: '#888888',
    fontWeight: '400',
  },

  // ── Card ──
  card: {
    backgroundColor: '#1A1A1A',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333333',
    paddingHorizontal: 22,
    paddingVertical: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FAFAFA',
    textAlign: 'center',
    marginBottom: 4,
  },
  cardSubtitle: {
    fontSize: 13,
    color: '#888888',
    textAlign: 'center',
    marginBottom: 24,
  },

  // ── Inputs ──
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#888888',
    marginBottom: 6,
    paddingLeft: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#222222',
    borderWidth: 1,
    borderColor: '#333333',
    borderRadius: 6,
    paddingHorizontal: 14,
    height: 50,
  },
  inputField: {
    flex: 1,
    fontSize: 16,
    color: '#FAFAFA',
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
    borderColor: '#666666',
  },
  phoneIconNotch: {
    width: 6,
    height: 2,
    borderRadius: 1,
    backgroundColor: '#666666',
    position: 'absolute',
    bottom: 2,
  },
  userIconHead: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#666666',
    position: 'absolute',
    top: 2,
  },
  userIconBody: {
    width: 16,
    height: 8,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    borderWidth: 2,
    borderColor: '#666666',
    borderBottomWidth: 0,
    position: 'absolute',
    bottom: 2,
  },

  // ── Button ──
  submitBtn: {
    borderRadius: 100,
    overflow: 'hidden',
    marginTop: 8,
  },
  submitBtnDisabled: {
    opacity: 0.6,
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
    borderColor: '#50e3c2',
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
    backgroundColor: '#50e3c2',
    marginTop: -2,
  },
  trustText: {
    fontSize: 12,
    color: '#666666',
  },

  // ── Modal ──
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#1A1A1A',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333333',
    padding: 20,
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FAFAFA',
    marginBottom: 4,
  },
  modalSubtitle: {
    fontSize: 13,
    color: '#888888',
    marginBottom: 12,
    textAlign: 'center',
  },
  modalCloseBtn: {
    marginTop: 8,
    paddingVertical: 8,
  },
  modalCloseText: {
    color: '#666666',
    fontSize: 14,
  },
})
