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

      // 🔴 高风险风控拦截（40300/40301）→ 自动跳风控页
      if (data.code === 40300 || data.code === 40301) {
        console.log('[Interceptor] 命中风控拦截, code:', data.code)
        navigate('RiskBlockScreen')
      }

      // 🔴 IP临时黑名单（40302）→ 提示并跳风控页
      if (data.code === 40302) {
        console.log('[Interceptor] IP临时黑名单拦截')
        navigate('RiskBlockScreen')
      }

      // ⚠️ 注意：40101（中风险人机验证）不清空本地数据
      // 它由业务页面自行处理（弹出验证码组件），不是鉴权失败
    }

    return Promise.reject(error)
  }
)

export default client