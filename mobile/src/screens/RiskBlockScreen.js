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

          <Text style={styles.title}>Access Restricted</Text>
          <Text style={styles.desc}>
            Your account has been restricted by the fraud prevention system
          </Text>

          <View style={styles.divider} />

          <Text style={styles.reasonLabel}>Reason</Text>
          <Text style={styles.reason}>
            Historical account cancellation detected.{'\n'}Cannot re-register within 90 days.
          </Text>

          <View style={styles.hintBox}>
            <Text style={styles.hintText}>Please try again after 90 days</Text>
          </View>
        </View>

        {/* ── Back ── */}
        <TouchableOpacity style={styles.btn} onPress={handleBack} activeOpacity={0.8}>
          <Text style={styles.btnText}>Back to Home</Text>
        </TouchableOpacity>

      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#171717' },
  container: { flex: 1, paddingHorizontal: 24, paddingTop: 60, paddingBottom: 40 },

  header: { alignItems: 'center', marginBottom: 32 },
  brand: { fontSize: 24, fontWeight: '700', color: '#FAFAFA', letterSpacing: -0.6 },

  card: {
    backgroundColor: '#1A1A1A', borderRadius: 8,
    borderWidth: 1, borderColor: '#5C1A1A',
    padding: 28, alignItems: 'center', marginBottom: 24,
  },
  iconRing: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: '#1A0A0A', borderWidth: 2, borderColor: '#5C1A1A',
    justifyContent: 'center', alignItems: 'center', marginBottom: 20,
  },
  iconX: { fontSize: 28, fontWeight: '800', color: '#ee0000' },
  title: { fontSize: 20, fontWeight: '700', color: '#ee0000', marginBottom: 8 },
  desc: { fontSize: 15, color: '#CC3333', textAlign: 'center', lineHeight: 22, fontWeight: '500' },
  divider: { width: '100%', height: 1, backgroundColor: '#333333', marginVertical: 20 },
  reasonLabel: { fontSize: 12, fontWeight: '600', color: '#888888', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  reason: { fontSize: 14, color: '#888888', textAlign: 'center', lineHeight: 22, marginBottom: 20 },
  hintBox: {
    backgroundColor: '#1A1A1A', borderRadius: 6,
    paddingHorizontal: 16, paddingVertical: 12, width: '100%', borderWidth: 1, borderColor: '#333333',
  },
  hintText: { fontSize: 13, color: '#666666', textAlign: 'center', fontWeight: '500' },

  btn: {
    borderRadius: 6, borderWidth: 1, borderColor: '#333333',
    paddingVertical: 14, alignItems: 'center',
  },
  btnText: { color: '#888888', fontSize: 15, fontWeight: '600' },
})
