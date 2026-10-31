/// <reference path="../pb_data/types.d.ts" />

// 验证码发送的 IP 维度限流需要记录请求来源（只存哈希，不存明文 IP）。
// 记录表仅服务端 hook 可访问；哈希用于在 1 小时窗口内计数，不保留原始 IP。
migrate((app) => {
  const codes = app.findCollectionByNameOrId('email_verification_codes');
  if (!codes.fields.getByName('requestIpHash')) {
    codes.fields.add(new TextField({ name: 'requestIpHash', max: 64 }));
  }
  const index = 'CREATE INDEX idx_email_codes_ip_created ON email_verification_codes (requestIpHash, created)';
  if (!(codes.indexes || []).includes(index)) {
    codes.indexes = [...(codes.indexes || []), index];
  }
  app.save(codes);
}, (app) => {
  const codes = app.findCollectionByNameOrId('email_verification_codes');
  if (codes.fields.getByName('requestIpHash')) {
    codes.fields.removeByName('requestIpHash');
  }
  codes.indexes = (codes.indexes || []).filter((item) => !item.includes('idx_email_codes_ip_created'));
  app.save(codes);
});
