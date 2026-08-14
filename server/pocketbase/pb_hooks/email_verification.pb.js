/// <reference path="../pb_data/types.d.ts" />

// PocketBase 0.39 会在独立 VM 中执行每个路由回调，因此每个回调都必须自包含，
// 不能依赖文件级的函数或常量。
routerAdd('POST', '/api/pianke/auth/send-register-code', (e) => {
  const email = String(e.requestInfo().body.email || '').trim().toLowerCase();
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(email)) return e.json(400, { message: '请输入有效的邮箱地址' });

  try {
    $app.findFirstRecordByFilter('users', 'email = {:email}', { email });
    return e.json(409, { message: '该邮箱已注册，请直接登录' });
  } catch (_) {
    // 未找到用户时继续创建验证码。
  }

  const latest = $app.findRecordsByFilter(
    'email_verification_codes',
    'email = {:email} && purpose = {:purpose}',
    '-expiresAt',
    1,
    0,
    { email, purpose: 'register' },
  )[0];
  if (latest && new Date(latest.getString('expiresAt')).getTime() - Date.now() > (10 * 60 - 30) * 1000) {
    return e.json(429, { message: '验证码发送过于频繁，请稍后再试' });
  }

  const code = $security.randomStringWithAlphabet(6, '0123456789');
  const codes = $app.findCollectionByNameOrId('email_verification_codes');
  const record = new Record(codes);
  record.set('email', email);
  record.set('purpose', 'register');
  record.set('codeHash', $security.sha256(code));
  record.set('expiresAt', new Date(Date.now() + 10 * 60 * 1000).toISOString());
  // PocketBase 的必填 number 字段将 0 视作空值，因此从 1 开始计数；
  // 下方以 >= 6 锁定，仍然只允许 5 次错误尝试。
  record.set('attempts', 1);
  $app.save(record);

  try {
    const settings = $app.settings();
    $app.newMailClient().send(new MailerMessage({
      from: {
        address: settings.meta.senderAddress,
        name: settings.meta.senderName,
      },
      to: [{ address: email }],
      subject: 'PianKe 注册验证码',
      html: `<p>你的 PianKe 验证码为：</p><p style="font-size:24px;font-weight:700;letter-spacing:4px">${code}</p><p>验证码 10 分钟内有效。若非本人操作，请忽略此邮件。</p>`,
    }));
  } catch (error) {
    $app.delete(record);
    console.error(`[email-verification] unable to send registration code: ${error}`);
    return e.json(502, { message: '验证码邮件发送失败，请稍后重试' });
  }
  return e.json(200, { message: '验证码已发送，请查收邮箱' });
}, $apis.requireGuestOnly());

routerAdd('POST', '/api/pianke/auth/register', (e) => {
  const body = e.requestInfo().body;
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const code = String(body.code || '').trim();
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(email)) return e.json(400, { message: '请输入有效的邮箱地址' });
  if (password.length < 8) return e.json(400, { message: '密码至少需要 8 位' });

  try {
    $app.findFirstRecordByFilter('users', 'email = {:email}', { email });
    return e.json(409, { message: '该邮箱已注册，请直接登录' });
  } catch (_) {
    // 未找到用户时继续注册。
  }

  const record = $app.findRecordsByFilter(
    'email_verification_codes',
    'email = {:email} && purpose = {:purpose}',
    '-expiresAt',
    1,
    0,
    { email, purpose: 'register' },
  )[0];
  if (!record) return e.json(400, { message: '请先获取验证码' });
  if (new Date(record.getString('expiresAt')).getTime() <= Date.now()) {
    return e.json(400, { message: '验证码已过期，请重新获取' });
  }
  if (record.getInt('attempts') >= 6) return e.json(400, { message: '验证码错误次数过多，请重新获取' });
  if (record.getString('codeHash') !== $security.sha256(code)) {
    record.set('attempts', record.getInt('attempts') + 1);
    $app.save(record);
    return e.json(400, { message: '验证码错误或已失效' });
  }
  const users = $app.findCollectionByNameOrId('users');
  const user = new Record(users);
  user.set('email', email);
  user.set('password', password);
  user.set('passwordConfirm', password);
  user.set('displayName', String(body.displayName || '').trim());
  user.set('verified', true);
  $app.save(user);
  $app.delete(record);
  return e.json(201, { message: '账号创建成功' });
}, $apis.requireGuestOnly());

routerAdd('POST', '/api/pianke/auth/send-password-code', (e) => {
  const email = e.auth.getString('email');
  const latest = $app.findRecordsByFilter(
    'email_verification_codes',
    'email = {:email} && purpose = {:purpose}',
    '-expiresAt',
    1,
    0,
    { email, purpose: 'change_password' },
  )[0];
  if (latest && new Date(latest.getString('expiresAt')).getTime() - Date.now() > (10 * 60 - 30) * 1000) {
    return e.json(429, { message: '验证码发送过于频繁，请稍后再试' });
  }

  const code = $security.randomStringWithAlphabet(6, '0123456789');
  const codes = $app.findCollectionByNameOrId('email_verification_codes');
  const record = new Record(codes);
  record.set('email', email);
  record.set('purpose', 'change_password');
  record.set('codeHash', $security.sha256(code));
  record.set('expiresAt', new Date(Date.now() + 10 * 60 * 1000).toISOString());
  // PocketBase 的必填 number 字段将 0 视作空值，因此从 1 开始计数；
  // 下方以 >= 6 锁定，仍然只允许 5 次错误尝试。
  record.set('attempts', 1);
  $app.save(record);

  try {
    const settings = $app.settings();
    $app.newMailClient().send(new MailerMessage({
      from: {
        address: settings.meta.senderAddress,
        name: settings.meta.senderName,
      },
      to: [{ address: email }],
      subject: 'PianKe 修改密码验证码',
      html: `<p>你的 PianKe 验证码为：</p><p style="font-size:24px;font-weight:700;letter-spacing:4px">${code}</p><p>验证码 10 分钟内有效。若非本人操作，请忽略此邮件。</p>`,
    }));
  } catch (error) {
    $app.delete(record);
    console.error(`[email-verification] unable to send password change code: ${error}`);
    return e.json(502, { message: '验证码邮件发送失败，请稍后重试' });
  }

  return e.json(200, { message: '验证码已发送，请查收邮箱' });
}, $apis.requireAuth('users'));

routerAdd('POST', '/api/pianke/auth/send-password-reset-code', (e) => {
  const email = String(e.requestInfo().body.email || '').trim().toLowerCase();
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(email)) return e.json(400, { message: '请输入有效的邮箱地址' });

  let user;
  try {
    user = $app.findFirstRecordByFilter('users', 'email = {:email}', { email });
  } catch (_) {
    // 始终返回相同结果，避免调用方据此枚举已注册邮箱。
    return e.json(200, { message: '如该邮箱已注册，验证码将发送至邮箱' });
  }

  const latest = $app.findRecordsByFilter(
    'email_verification_codes',
    'email = {:email} && purpose = {:purpose}',
    '-expiresAt',
    1,
    0,
    { email, purpose: 'reset_password' },
  )[0];
  if (latest && new Date(latest.getString('expiresAt')).getTime() - Date.now() > (10 * 60 - 30) * 1000) {
    return e.json(200, { message: '如该邮箱已注册，验证码将发送至邮箱' });
  }

  const code = $security.randomStringWithAlphabet(6, '0123456789');
  const codes = $app.findCollectionByNameOrId('email_verification_codes');
  const record = new Record(codes);
  record.set('email', email);
  record.set('purpose', 'reset_password');
  record.set('codeHash', $security.sha256(code));
  record.set('expiresAt', new Date(Date.now() + 10 * 60 * 1000).toISOString());
  record.set('attempts', 1);
  $app.save(record);

  try {
    const settings = $app.settings();
    $app.newMailClient().send(new MailerMessage({
      from: {
        address: settings.meta.senderAddress,
        name: settings.meta.senderName,
      },
      to: [{ address: user.getString('email') }],
      subject: 'PianKe 重置密码验证码',
      html: `<p>你的 PianKe 重置密码验证码为：</p><p style="font-size:24px;font-weight:700;letter-spacing:4px">${code}</p><p>验证码 10 分钟内有效。若非本人操作，请忽略此邮件。</p>`,
    }));
  } catch (error) {
    $app.delete(record);
    console.error(`[email-verification] unable to send password reset code: ${error}`);
    return e.json(502, { message: '验证码邮件发送失败，请稍后重试' });
  }

  return e.json(200, { message: '如该邮箱已注册，验证码将发送至邮箱' });
}, $apis.requireGuestOnly());

routerAdd('POST', '/api/pianke/auth/reset-password', (e) => {
  const body = e.requestInfo().body;
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const code = String(body.code || '').trim();
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(email)) return e.json(400, { message: '请输入有效的邮箱地址' });
  if (password.length < 8) return e.json(400, { message: '新密码至少需要 8 位' });

  let user;
  try {
    user = $app.findFirstRecordByFilter('users', 'email = {:email}', { email });
  } catch (_) {
    return e.json(400, { message: '验证码错误或已失效' });
  }

  const record = $app.findRecordsByFilter(
    'email_verification_codes',
    'email = {:email} && purpose = {:purpose}',
    '-expiresAt',
    1,
    0,
    { email, purpose: 'reset_password' },
  )[0];
  if (!record) return e.json(400, { message: '请先获取验证码' });
  if (new Date(record.getString('expiresAt')).getTime() <= Date.now()) {
    return e.json(400, { message: '验证码已过期，请重新获取' });
  }
  if (record.getInt('attempts') >= 6) return e.json(400, { message: '验证码错误次数过多，请重新获取' });
  if (record.getString('codeHash') !== $security.sha256(code)) {
    record.set('attempts', record.getInt('attempts') + 1);
    $app.save(record);
    return e.json(400, { message: '验证码错误或已失效' });
  }
  user.set('password', password);
  user.set('passwordConfirm', password);
  $app.save(user);
  $app.delete(record);
  return e.json(200, { message: '密码重置成功' });
}, $apis.requireGuestOnly());

routerAdd('POST', '/api/pianke/auth/change-password', (e) => {
  const body = e.requestInfo().body;
  const password = String(body.password || '');
  if (password.length < 8) return e.json(400, { message: '新密码至少需要 8 位' });
  if (!e.auth.validatePassword(String(body.currentPassword || ''))) {
    return e.json(400, { message: '当前密码不正确' });
  }

  const email = e.auth.getString('email');
  const record = $app.findRecordsByFilter(
    'email_verification_codes',
    'email = {:email} && purpose = {:purpose}',
    '-expiresAt',
    1,
    0,
    { email, purpose: 'change_password' },
  )[0];
  if (!record) return e.json(400, { message: '请先获取验证码' });
  if (new Date(record.getString('expiresAt')).getTime() <= Date.now()) {
    return e.json(400, { message: '验证码已过期，请重新获取' });
  }
  if (record.getInt('attempts') >= 6) return e.json(400, { message: '验证码错误次数过多，请重新获取' });
  if (record.getString('codeHash') !== $security.sha256(String(body.code || '').trim())) {
    record.set('attempts', record.getInt('attempts') + 1);
    $app.save(record);
    return e.json(400, { message: '验证码错误或已失效' });
  }
  e.auth.set('password', password);
  e.auth.set('passwordConfirm', password);
  $app.save(e.auth);
  $app.delete(record);
  return e.json(200, { message: '密码修改成功' });
}, $apis.requireAuth('users'));

// 个人资料仍可由用户自己更新，但公共 API 不得修改密码，从而不能绕过邮箱验证码。
onRecordUpdateRequest((e) => {
  const body = e.requestInfo().body;
  if (body.password || body.passwordConfirm || body.oldPassword) {
    throw new ForbiddenError('修改密码前请完成邮箱验证码验证');
  }
  e.next();
}, 'users');
