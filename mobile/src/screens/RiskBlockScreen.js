import React from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { storage } from '../utils/secureStore'
import { navigate } from '../navigation/RootNavigation'

export default function RiskBlockScreen() {
  const handleBack = async () => {
    await storage.removeItem('user_info')
    navigate('RegisterScreen')
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>

        {/* ── Header ── */}
        <View style={styles.header}>
          <Text style={styles.brand}>停小券</Text>
        </View>

        {/* ── Block Card ── */}
        <View style={styles.card}>
          {/* Icon ring */}
          <View style={styles.iconRing}>
            <Text style={styles.iconX}>!</Text>
          </View>

          <Text style={styles.title}>操作受限</Text>
          <Text style={styles.desc}>
            当前账号因触发风控策略已被系统限制
          </Text>

          <View style={styles.divider} />

          <Text style={styles.reasonLabel}>原因说明</Text>
          <Text style={styles.reason}>
            检测到该手机号存在历史注销记录，{'\n'}90 天内无法再次领取免费停车券。
          </Text>

          <View style={styles.hintBox}>
            <Text style={styles.hintText}>请于 90 天后重新尝试</Text>
          </View>
        </View>

        {/* ── Back ── */}
        <TouchableOpacity style={styles.btn} onPress={handleBack} activeOpacity={0.8}>
          <Text style={styles.btnText}>返回首页</Text>
        </TouchableOpacity>

      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F8FAFC' },
  container: { flex: 1, paddingHorizontal: 24, paddingTop: 60, paddingBottom: 40 },

  header: { alignItems: 'center', marginBottom: 32 },
  brand: { fontSize: 24, fontWeight: '700', color: '#0F172A', letterSpacing: 0.5 },

  card: {
    backgroundColor: '#FFFFFF', borderRadius: 20,
    borderWidth: 1, borderColor: '#FECACA',
    padding: 28, alignItems: 'center', marginBottom: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  iconRing: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: '#FEF2F2', borderWidth: 2, borderColor: '#FECACA',
    justifyContent: 'center', alignItems: 'center', marginBottom: 20,
  },
  iconX: { fontSize: 28, fontWeight: '800', color: '#DC2626' },
  title: { fontSize: 20, fontWeight: '700', color: '#DC2626', marginBottom: 8 },
  desc: { fontSize: 15, color: '#991B1B', textAlign: 'center', lineHeight: 22, fontWeight: '500' },
  divider: { width: '100%', height: 1, backgroundColor: '#F1F5F9', marginVertical: 20 },
  reasonLabel: { fontSize: 13, fontWeight: '600', color: '#64748B', marginBottom: 8 },
  reason: { fontSize: 14, color: '#475569', textAlign: 'center', lineHeight: 22, marginBottom: 20 },
  hintBox: {
    backgroundColor: '#F8FAFC', borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 12, width: '100%', borderWidth: 1, borderColor: '#E2E8F0',
  },
  hintText: { fontSize: 13, color: '#64748B', textAlign: 'center', fontWeight: '500' },

  btn: {
    borderRadius: 14, borderWidth: 1, borderColor: '#CBD5E1',
    paddingVertical: 14, alignItems: 'center',
  },
  btnText: { color: '#475569', fontSize: 15, fontWeight: '600' },
})
