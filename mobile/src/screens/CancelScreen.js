import React, { useState, useEffect } from 'react'
import {
  View, Text, TouchableOpacity, Alert, StyleSheet,
  KeyboardAvoidingView, ScrollView, Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import client from '../api/interceptors'
import { storage } from '../utils/secureStore'
import { getDeviceId } from '../utils/deviceId'
import { navigate } from '../navigation/RootNavigation'

export default function CancelScreen() {
  const [userInfo, setUserInfo] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const load = async () => {
      const info = await storage.getItem('user_info')
      setUserInfo(info)
    }
    load()
  }, [])

  const handleCancel = () => {
    Alert.alert('确认注销', '注销后停车券将失效，90 天内无法再次领取。确定继续？', [
      { text: '取消', style: 'cancel' },
      {
        text: '确认注销', style: 'destructive',
        onPress: async () => {
          setLoading(true)
          try {
            const deviceId = await getDeviceId()
            await Promise.race([
              client.post('/user/cancel', { phone: userInfo?.phone, deviceId }),
              new Promise((_, reject) => setTimeout(() => reject(new Error('请求超时，请重试')), 15000))
            ])
            await storage.removeItem('user_info')
            navigate('RegisterScreen')
            Alert.alert('已注销', '账号信息已完成合规擦除')
          } catch (err) {
            Alert.alert('错误', err.response?.data?.message || '注销失败')
          } finally {
            setLoading(false)
          }
        }
      }
    ])
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <Text style={styles.brand}>停小券</Text>
            <Text style={styles.brandSub}>账号注销</Text>
          </View>

          <View style={styles.warnCard}>
            <Text style={styles.warnTitle}>请注意</Text>
            <Text style={styles.warnItem}>· 注销后停车券将立即失效</Text>
            <Text style={styles.warnItem}>· 90 天内无法重新领取</Text>
            <Text style={styles.warnItem}>· 个人信息将被合规擦除</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>
              当前账号：{userInfo?.phone || '加载中...'}
            </Text>
            <Text style={styles.cardHint}>确认后将永久注销该账号</Text>

            <TouchableOpacity
              style={[styles.btn, loading && { opacity: 0.5 }]}
              onPress={handleCancel}
              disabled={loading}
              activeOpacity={0.85}
            >
              <Text style={styles.btnText}>{loading ? '处理中...' : '确认注销账号'}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { flex: 1, backgroundColor: '#F8FAFC' },
  container: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 60, paddingBottom: 40 },

  header: { alignItems: 'center', marginBottom: 28 },
  brand: { fontSize: 24, fontWeight: '700', color: '#0F172A', letterSpacing: 0.5, marginBottom: 4 },
  brandSub: { fontSize: 13, color: '#64748B' },

  warnCard: {
    backgroundColor: '#FFFBEB', borderRadius: 16,
    borderWidth: 1, borderColor: '#FDE68A', padding: 20, marginBottom: 16,
  },
  warnTitle: { fontSize: 15, fontWeight: '700', color: '#D97706', marginBottom: 12 },
  warnItem: { fontSize: 13, color: '#92400E', lineHeight: 24 },

  card: {
    backgroundColor: '#FFFFFF', borderRadius: 20, borderWidth: 1, borderColor: '#E2E8F0',
    padding: 24, alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  cardTitle: { fontSize: 14, fontWeight: '600', color: '#0F172A', marginBottom: 8 },
  cardHint: { fontSize: 12, color: '#94A3B8', marginBottom: 24 },
  btn: {
    width: '100%', backgroundColor: '#DC2626', borderRadius: 14,
    paddingVertical: 14, alignItems: 'center',
  },
  btnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
})
