import React, { useState, useEffect } from 'react'
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import client from '../api/interceptors'
import { storage } from '../utils/secureStore'
import { navigate } from '../navigation/RootNavigation'

export default function HomeScreen() {
  const [userInfo, setUserInfo] = useState(null)

  useEffect(() => {
    const loadUser = async () => {
      const info = await storage.getItem('user_info')
      setUserInfo(info)
    }
    loadUser()
  }, [])

  const handleLogout = async () => {
    await storage.removeItem('user_info')
    navigate('RegisterScreen')
  }

  const handleCancel = () => {
    navigate('CancelScreen')
  }

  if (!userInfo) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>加载中...</Text>
        </View>
      </SafeAreaView>
    )
  }

  const isExisting = userInfo.isExisting
  const cardBg = isExisting ? '#FFFBEB' : '#F0FDF4'
  const cardBorder = isExisting ? '#FCD34D' : '#BBF7D0'
  const titleColor = isExisting ? '#D97706' : '#059669'

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>

        {/* ── Header ── */}
        <View style={styles.header}>
          <Text style={styles.brand}>停小券</Text>
          <Text style={styles.brandSub}>免费停车券 · 一键领取</Text>
        </View>

        {/* ── Status Card ── */}
        <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
          {/* Status Icon */}
          <View style={[styles.badge, { backgroundColor: isExisting ? '#FDE68A' : '#A7F3D0' }]}>
            <Text style={[styles.badgeLabel, { color: titleColor }]}>
              {isExisting ? '已有账户' : '新用户'}
            </Text>
          </View>

          <Text style={[styles.title, { color: titleColor }]}>
            {isExisting ? '欢迎回来' : '注册成功'}
          </Text>
          <Text style={[styles.subtitle, { color: isExisting ? '#F59E0B' : '#10B981' }]}>
            {isExisting ? '您的停车券已领取' : '停车券已发放到您的账户'}
          </Text>

          <View style={styles.divider} />

          <View style={styles.row}>
            <Text style={styles.label}>手机号</Text>
            <Text style={styles.value}>{userInfo.phone}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>停车券</Text>
            <Text style={styles.value}>{userInfo.hasCoupon ? '正常可用' : '已失效'}</Text>
          </View>
        </View>

        {/* ── Actions ── */}
        <TouchableOpacity style={styles.btnOutline} onPress={handleLogout} activeOpacity={0.8}>
          <Text style={styles.btnOutlineText}>退出登录</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.btnDanger} onPress={handleCancel} activeOpacity={0.8}>
          <Text style={styles.btnDangerText}>注销账号</Text>
        </TouchableOpacity>

        <Text style={styles.footer}>数据加密传输 · 隐私安全保护</Text>

      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F8FAFC' },
  container: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 60, paddingBottom: 40 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { fontSize: 15, color: '#94A3B8' },

  header: { alignItems: 'center', marginBottom: 32 },
  brand: { fontSize: 24, fontWeight: '700', color: '#0F172A', letterSpacing: 0.5, marginBottom: 4 },
  brandSub: { fontSize: 13, color: '#64748B' },

  card: {
    borderRadius: 20, borderWidth: 1,
    padding: 24, marginBottom: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  badge: {
    alignSelf: 'flex-start', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 4, marginBottom: 16,
  },
  badgeLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 4 },
  subtitle: { fontSize: 14, fontWeight: '500', marginBottom: 24 },
  divider: { height: 1, backgroundColor: '#E2E8F0', marginBottom: 20 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10 },
  label: { fontSize: 14, color: '#64748B' },
  value: { fontSize: 14, color: '#0F172A', fontWeight: '600' },

  btnOutline: {
    borderRadius: 14, borderWidth: 1, borderColor: '#CBD5E1',
    paddingVertical: 14, alignItems: 'center', marginBottom: 12,
  },
  btnOutlineText: { color: '#475569', fontSize: 15, fontWeight: '600' },
  btnDanger: {
    borderRadius: 14, backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA',
    paddingVertical: 14, alignItems: 'center',
  },
  btnDangerText: { color: '#DC2626', fontSize: 15, fontWeight: '600' },
  footer: { textAlign: 'center', marginTop: 32, fontSize: 12, color: '#94A3B8' },
})
