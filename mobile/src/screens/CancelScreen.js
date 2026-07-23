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
    Alert.alert('Confirm Deletion', 'Your coupon will become invalid. Cannot re-register for 90 days. Continue?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Confirm', style: 'destructive',
        onPress: async () => {
          setLoading(true)
          try {
            const deviceId = await getDeviceId()
            await Promise.race([
              client.post('/user/cancel', { phone: userInfo?.phone, deviceId }),
              new Promise((_, reject) => setTimeout(() => reject(new Error('Request timed out')), 15000))
            ])
            await storage.removeItem('user_info')
            navigate('RegisterScreen')
            Alert.alert('Deleted', 'Account data has been permanently erased')
          } catch (err) {
            Alert.alert('Error', err.response?.data?.message || 'Deletion failed')
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
  safeArea: { flex: 1, backgroundColor: '#171717' },
  container: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 60, paddingBottom: 40 },

  header: { alignItems: 'center', marginBottom: 28 },
  brand: { fontSize: 24, fontWeight: '700', color: '#FAFAFA', letterSpacing: -0.6, marginBottom: 4 },
  brandSub: { fontSize: 13, color: '#888888' },

  warnCard: {
    backgroundColor: '#1A1A00', borderRadius: 8,
    borderWidth: 1, borderColor: '#665500', padding: 20, marginBottom: 16,
  },
  warnTitle: { fontSize: 15, fontWeight: '700', color: '#f5a623', marginBottom: 12 },
  warnItem: { fontSize: 13, color: '#CCA300', lineHeight: 24 },

  card: {
    backgroundColor: '#1A1A1A', borderRadius: 8, borderWidth: 1, borderColor: '#333333',
    padding: 24, alignItems: 'center',
  },
  cardTitle: { fontSize: 14, fontWeight: '600', color: '#FAFAFA', marginBottom: 8 },
  cardHint: { fontSize: 12, color: '#666666', marginBottom: 24 },
  btn: {
    width: '100%', backgroundColor: '#ee0000', borderRadius: 6,
    paddingVertical: 14, alignItems: 'center',
  },
  btnText: { color: '#FAFAFA', fontSize: 16, fontWeight: '700' },
})
