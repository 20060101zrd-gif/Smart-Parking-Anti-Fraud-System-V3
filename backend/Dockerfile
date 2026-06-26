# 🚀 彻底抛弃前缀，直接使用我们刚才在本地“偷天换日”伪装好的原版镜像！
FROM node:18-alpine

WORKDIR /app

# 替换阿里源 + 修复 Python 3.12 缺少 distutils 的问题
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories \
    && apk update \
    && apk add --no-cache python3 make g++ py3-setuptools

COPY package*.json ./

RUN npm config set registry https://registry.npmmirror.com/ && npm install

COPY . .

EXPOSE 3000

CMD ["npm", "run", "start"]