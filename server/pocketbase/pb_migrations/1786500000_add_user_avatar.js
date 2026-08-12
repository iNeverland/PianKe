/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const users = app.findCollectionByNameOrId('users');
  users.fields.add(new FileField({
    name: 'avatar',
    maxSelect: 1,
    maxSize: 5 * 1024 * 1024,
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    thumbs: ['160x160'],
  }));
  app.save(users);
}, (app) => {
  const users = app.findCollectionByNameOrId('users');
  users.fields.removeByName('avatar');
  app.save(users);
});
