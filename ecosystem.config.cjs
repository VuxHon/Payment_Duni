module.exports = {
  apps: [{
    name: 'payment-duni',
    cwd: '/root/Payment_Duni',
    script: 'server/dist/index.js',
    interpreter: 'node',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    max_memory_restart: '350M',
    env: { NODE_ENV: 'production', PORT: 3017 },
    time: true
  }]
};
