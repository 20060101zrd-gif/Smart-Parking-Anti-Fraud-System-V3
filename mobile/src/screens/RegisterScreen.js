import React, { useState, useEffect } from 'react'
import { View, Text, TextInput, TouchableOpacity, Alert, StyleSheet } from 'react-native'
import client from '../api/interceptors'
import { storage } from '../utils/secureStore'
import { navigate } from '../navigation/RootNavigation'

export default function RegisterScreen() {
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)

  // 进入页面先检查有没有已注册的用户
  useEffect(() => {
    const checkUser = async () => {
      const userInfo = await storage.getItem('user_info')
      if (userInfo?.hasCoupon) {
        // 已经领过券了，直接跳主页
        navigate('HomeScreen')
      }
    }
    checkUser()
  }, [])

  const handleRegister = async () => {
    if (!phone || !name) {
      Alert.alert('提示', '请输入手机号和姓名')
      return
    }

    setLoading(true)
    try {
      const res = await client.post('/user/register', { phone, name })
      
      if (res.data.code === 20000) {
        const { hasCoupon, isExisting } = res.data.data

        // 保存用户信息到安全存储（带上 isExisting 标记）
        await storage.setItem('user_info', {
          phone,
          hasCoupon,
          isExisting: isExisting || false
        })

        // ========== 👇 修改：根据是否已注册显示不同提示 ==========
        if (isExisting) {
          // 已注册用户，直接跳主页，不弹新注册提示
          navigate('HomeScreen')
        } else {
          // 新用户，弹注册成功提示
          Alert.alert('🎉 注册成功', '停车券已发放到您的账户')
          navigate('HomeScreen')
        }
        // ========== 👆 修改结束 ==========
      }
    } catch (err) {
      // 注意：40300 风控拦截会被拦截器处理并跳转，这里不用管
      // 只处理其他错误
      if (err.response?.data?.code !== 40300) {
        Alert.alert('错误', err.response?.data?.message || '注册失败')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>注册领券</Text>
      
      <TextInput
        style={styles.input}
        placeholder="请输入手机号"
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
      />
      
      <TextInput
        style={styles.input}
        placeholder="请输入姓名"
        value={name}
        onChangeText={setName}
      />
      
      <TouchableOpacity 
        style={styles.button} 
        onPress={handleRegister}
        disabled={loading}
      >
        <Text style={styles.buttonText}>
          {loading ? '提交中...' : '注册领券'}
        </Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    justifyContent: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 30,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 12,
    marginBottom: 15,
  },
  button: {
    backgroundColor: '#007AFF',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
})