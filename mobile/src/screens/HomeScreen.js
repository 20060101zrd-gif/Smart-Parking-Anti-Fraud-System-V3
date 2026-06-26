import React from 'react'
import { View, Text, TouchableOpacity, Alert, StyleSheet } from 'react-native'
import client from '../api/interceptors'
import { storage } from '../utils/secureStore'
import { navigate } from '../navigation/RootNavigation'

export default function HomeScreen() {
  const [userInfo, setUserInfo] = React.useState(null)

  // 进入页面时读取本地用户信息
  React.useEffect(() => {
    const loadUser = async () => {
      const info = await storage.getItem('user_info')
      setUserInfo(info)
    }
    loadUser()
  }, [])

  // 注销账号
  const handleCancel = async () => {
    Alert.alert(
      '确认注销',
      '注销后您的停车券将失效，且90天内无法再次领取，确定继续吗？',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '确定注销',
          style: 'destructive',
          onPress: async () => {
            try {
              await client.post('/user/cancel', { phone: userInfo.phone })
              // 注销成功，清空本地数据
              await storage.removeItem('user_info')
              // 跳回注册页
              navigate('RegisterScreen')
              Alert.alert('提示', '账号已注销')
            } catch (err) {
              Alert.alert('错误', err.response?.data?.message || '注销失败')
            }
          }
        }
      ]
    )
  }

  if (!userInfo) {
    return <View style={styles.container}><Text>加载中...</Text></View>
  }

  const isExisting = userInfo.isExisting

  return (
    <View style={styles.container}>
      {/* 已注册用户：浅黄色卡片 + 欢迎回来文案 */}
      <View style={[styles.card, isExisting && styles.cardExisting]}>
        <Text style={[styles.title, isExisting && styles.titleExisting]}>
          {isExisting ? '👋 欢迎回来，您的停车券已领取' : '🎉 停车券已领取'}
        </Text>
        <Text style={styles.phone}>手机号：{userInfo.phone}</Text>
        <Text style={[styles.status, isExisting ? styles.statusExisting : styles.statusNew]}>
          状态：{userInfo.hasCoupon ? '正常可用' : '已失效'}
        </Text>
      </View>

      <TouchableOpacity style={styles.cancelBtn} onPress={handleCancel}>
        <Text style={styles.cancelText}>注销账号</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#f5f5f5',
  },
  // 新用户卡片（白色背景）
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    marginTop: 40,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 20,
    color: '#16a34a',
  },
  phone: {
    fontSize: 16,
    marginBottom: 10,
    color: '#333',
  },
  status: {
    fontSize: 16,
    fontWeight: '600',
  },
  statusNew: {
    color: '#16a34a',
  },
  cancelBtn: {
    marginTop: 40,
    backgroundColor: '#ef4444',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
  },
  cancelText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },

  // ===== 已注册用户：浅黄色卡片 =====
  cardExisting: {
    backgroundColor: '#fef3c7', // 浅黄色背景
    borderWidth: 1,
    borderColor: '#fcd34d',
  },
  titleExisting: {
    color: '#d97706', // 深黄色标题
  },
  statusExisting: {
    color: '#d97706', // 深黄色状态文字
  },
})