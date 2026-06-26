import client from './clients'
import { storage } from '../utils/secureStore'
import { navigate } from '../navigation/RootNavigation'

// 响应拦截器
client.interceptors.response.use(
  (response) => {
    return response
  },
  async (error) => {
    if (error.response) {
      const { status, data } = error.response

      // 40300 风控拦截 → 自动跳风控页
      if (data.code === 40300) {
        console.log('命中风控拦截')
        navigate('RiskBlockScreen')
      }

      // 401 未授权，清空本地数据
      if (status === 401) {
        await storage.removeItem('user_info')
      }
    }

    return Promise.reject(error)
  }
)

export default client