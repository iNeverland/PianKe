/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const codes = app.findCollectionByNameOrId('email_verification_codes');
  const purpose = codes.fields.getByName('purpose');
  if (!purpose.values.includes('reset_password')) {
    purpose.values = [...purpose.values, 'reset_password'];
    app.save(codes);
  }
}, (app) => {
  const codes = app.findCollectionByNameOrId('email_verification_codes');
  const purpose = codes.fields.getByName('purpose');
  purpose.values = purpose.values.filter((value) => value !== 'reset_password');
  app.save(codes);
});
