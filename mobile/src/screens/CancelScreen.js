import React from 'react';
import { View, Button, Alert, StyleSheet } from 'react-native';
import client from '../api/clients';
import { storage } from '../utils/secureStore';

export default function CancelScreen() {
  const handleCancel = async () => {
    try {
      await client.post('/user/cancel');
      await storage.removeItem('user_token');
      Alert.alert('已注销', '您的数据已被物理擦除');
    } catch (e) {
      Alert.alert('错误', '注销失败');
    }
  };

  return (
    <View style={styles.container}>
      <Button title="确认物理擦除账号" color="red" onPress={handleCancel} />
    </View>
  );
}

const styles = StyleSheet.create({ container: { padding: 20 } });