export default {
  apps: [
    {
      name: 'strm-manager',
      script: 'server.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        PORT: 4173,
        DATABASE_PATH: './data/database.sqlite',
      },
    },
  ],
};
