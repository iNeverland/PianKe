/// <reference path="../pb_data/types.d.ts" />

// 头像属于隐私数据：users 集合本身是私有集合，但 file 字段默认不是 protected，
// 文件 URL 仍可能被直接访问。客户端生成 URL 时已经带短期 token，这里把字段补齐。
migrate((app) => {
  const users = app.findCollectionByNameOrId('users');
  const avatar = users.fields.getByName('avatar');
  if (!avatar) return;
  avatar.protected = true;
  app.save(users);
}, (app) => {
  const users = app.findCollectionByNameOrId('users');
  const avatar = users.fields.getByName('avatar');
  if (!avatar) return;
  avatar.protected = false;
  app.save(users);
});
