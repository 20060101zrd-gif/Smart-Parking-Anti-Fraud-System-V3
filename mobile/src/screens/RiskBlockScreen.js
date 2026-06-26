import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { storage } from '../utils/secureStore';
import { navigate } from '../navigation/RootNavigation';

export default function RiskBlockScreen() {
  const handleBack = async () => {
    // 清空本地残留数据
    await storage.removeItem('user_info');
    // 跳回注册页
    navigate('RegisterScreen');
  };

  return (
    <View style={styles.container}>
      <Text style={styles.icon}>🚫</Text>
      <Text style={styles.alertText}>
        当前账号因触发风控策略已被系统限制
      </Text>
      <Text style={styles.desc}>
        检测到该手机号历史注销记录，90天内无法再次领取停车券
      </Text>
      
      <TouchableOpacity style={styles.button} onPress={handleBack}>
        <Text style={styles.buttonText}>返回注册页</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({ 
  container: { 
    flex: 1, 
    justifyContent: 'center', 
    alignItems: 'center', 
    backgroundColor: '#fee2e2',
    padding: 20,
  },
  icon: {
    fontSize: 60,
    marginBottom: 20,
  },
  alertText: { 
    color: '#dc2626', 
    fontSize: 20, 
    fontWeight: 'bold', 
    marginBottom: 12,
    textAlign: 'center',
  },
  desc: {
    color: '#991b1b',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 40,
    lineHeight: 22,
  },
  button: {
    backgroundColor: '#dc2626',
    paddingHorizontal: 40,
    paddingVertical: 12,
    borderRadius: 8,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});