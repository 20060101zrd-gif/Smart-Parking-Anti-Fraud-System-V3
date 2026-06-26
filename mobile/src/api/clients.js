import axios from 'axios'
import { BASE_URL } from '../constants/urls'

const client = axios.create({
  baseURL: BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
})

export default client