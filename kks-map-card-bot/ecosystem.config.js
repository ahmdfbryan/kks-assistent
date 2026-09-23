module.exports = {
  apps: [
    {
      name: 'kks-map-card-bot',
      script: 'src/index.js',
      cwd: __dirname,
      autorestart: true,
      max_memory_restart: '200M',
      time: true,
    },
  ],
};
