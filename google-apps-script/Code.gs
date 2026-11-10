function doPost(e) {
  var reply = function(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return reply({status:'failed', error:'busy'});
  try {
    var request = JSON.parse(e.postData.contents);
    var secret = PropertiesService.getScriptProperties().getProperty('MIMI_MAIL_SIGNING_SECRET');
    if (!secret) return reply({status:'failed', error:'missing_signing_secret'});
    if (typeof request.payload !== 'string' || request.payload.length > 200000) throw Error('invalid');
    var expected = Utilities.computeHmacSha256Signature(request.payload, secret, Utilities.Charset.UTF_8).map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join('');
    var diff = expected.length ^ String(request.signature).length;
    for (var i=0;i<expected.length;i++) diff |= expected.charCodeAt(i) ^ String(request.signature).charCodeAt(i);
    if (diff) return reply({status:'failed', error:'signature_mismatch'});
    var data = JSON.parse(request.payload);
    if (!Number.isFinite(data.timestamp) || Math.abs(Date.now()-data.timestamp)>300000) return reply({status:'failed', error:'expired'});
    if (data.action === 'check') {
      try {
        return reply(MailApp.getRemainingDailyQuota() > 0
          ? {status:'ready'} : {status:'failed', error:'quota'});
      } catch (_) {
        return reply({status:'failed', error:'quota_check_failed'});
      }
    }
    if (data.to !== '1436035656@qq.com' || !/^mimi-[a-f0-9-]+-\d{4}-\d{2}-\d{2}$/.test(data.id)) throw Error('invalid');
    var props = PropertiesService.getScriptProperties();
    var key = 'delivery:'+data.id;
    var previous = props.getProperty(key);
    if (previous) return reply({status:previous === 'sent' ? 'sent' : 'uncertain'});
    if (MailApp.getRemainingDailyQuota()<1) return reply({status:'failed',error:'quota'});
    // Persist intent before sending: a crash must never trigger a blind resend.
    props.setProperty(key,'uncertain');
    try {
      MailApp.sendEmail({to:data.to, subject:data.subject, body:'请使用支持 HTML 的邮件客户端查看今日计划。', htmlBody:data.html, name:'Mimi'});
      props.setProperty(key,'sent');
      return reply({status:'sent'});
    } catch (_) { return reply({status:'uncertain'}); }
  } catch (_) { return reply({status:'failed',error:'request rejected'}); }
  finally { lock.releaseLock(); }
}
