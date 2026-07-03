import 'react-native-gesture-handler';
import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { navigationRef } from './src/navigation/RootNavigation';

// 引入页面
import RegisterScreen from './src/screens/RegisterScreenNew';
import HomeScreen from './src/screens/HomeScreen';
import RiskBlockScreen from './src/screens/RiskBlockScreen';
import CancelScreen from './src/screens/CancelScreen';

const Stack = createStackNavigator();

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" backgroundColor="#5B9BD5" />
      <NavigationContainer ref={navigationRef}>
        <Stack.Navigator
          initialRouteName="RegisterScreen"
          screenOptions={{
            headerStyle: { backgroundColor: '#5B9BD5' },
            headerTintColor: '#fff',
            headerTitleStyle: { fontWeight: '600' },
          }}
        >
          <Stack.Screen
            name="RegisterScreen"
            component={RegisterScreen}
            options={{ title: '注册领券', headerLeft: null }}
          />
          <Stack.Screen
            name="HomeScreen"
            component={HomeScreen}
            options={{ title: '我的停车券', headerLeft: null }}
          />
          <Stack.Screen
            name="RiskBlockScreen"
            component={RiskBlockScreen}
            options={{ title: '风控拦截', headerLeft: null }}
          />
          <Stack.Screen
            name="CancelScreen"
            component={CancelScreen}
            options={{ title: '账号注销' }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}