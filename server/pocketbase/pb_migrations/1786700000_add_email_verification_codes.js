/// <reference path="../pb_data/types.d.ts" />

// 验证码只允许 PocketBase hook 在服务端读写，不能通过公开 API 访问。
migrate((app) => {
  const users = app.findCollectionByNameOrId('users');
  const codes = new Collection({
    type: 'base',
    name: 'email_verification_codes',
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: 'email', type: 'email', required: true, max: 254 },
      { name: 'purpose', type: 'select', required: true, values: ['register', 'change_password'], maxSelect: 1 },
      { name: 'codeHash', type: 'text', required: true, max: 128 },
      { name: 'expiresAt', type: 'date', required: true },
      { name: 'attempts', type: 'number', required: true, min: 0, max: 10 },
    ],
  });
  app.save(codes);

  // 注册必须经过 hook 的验证码核验，不能再直接调用 users 的公开创建接口。
  users.createRule = null;
  app.save(users);
}, (app) => {
  app.delete(app.findCollectionByNameOrId('email_verification_codes'));
  const users = app.findCollectionByNameOrId('users');
  users.createRule = '';
  app.save(users);
});
