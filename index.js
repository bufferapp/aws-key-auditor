const { join, resolve } = require('path');
require('dotenv').config({
  path: resolve(__dirname, 'env/env'),
});
const { promisify } = require('util');
const { readFile } = require('fs');
const { compile } = require('handlebars');
const moment = require('moment');
const AWS = require('aws-sdk');
const sgMail = require('@sendgrid/mail');

const readFileAsync = promisify(readFile);

AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});
const iam = new AWS.IAM();

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const daysWarn = parseInt(process.env.DAYS_WARN, 10);
const daysError = parseInt(process.env.DAYS_ERROR, 10);

const generateHtmlEmail = async ({
  inactiveKeys,
  expireSoonKeys,
  expiredKeys,
}) => {
  const template = await readFileAsync(join(__dirname, './summaryemail.html'));
  const compiledTemplate = compile(template.toString());
  const html = compiledTemplate({
    inactiveKeys,
    expireSoonKeys,
    expiredKeys,
    daysError,
  });
  return html;
};

const sendEmail = async ({
  inactiveKeys,
  expireSoonKeys,
  expiredKeys,
}) => {
  const msg = {
    to: process.env.EMAIL_TO,
    from: process.env.EMAIL_FROM,
    replyTo: process.env.EMAIL_REPLY_TO,
    subject: `Found AWS Keys That Require Action (${moment().format('MMM Do, YYYY')})`,
    text: 'please request a text version',
    html: await generateHtmlEmail({
      inactiveKeys,
      expireSoonKeys,
      expiredKeys,
    }),
  };
  sgMail.send(msg);
};

const getKeyDetails = async ({
  keyNames,
}) => {
  const keyInfoFileContents = await readFileAsync(join(__dirname, './keys.info'));
  const keysToReturn = {};
  const keyListInfo = JSON.parse(keyInfoFileContents);
  keyListInfo.keys.forEach((keyInfo) => {
    if (keyNames.indexOf(keyInfo.name) !== -1) {
      keysToReturn[keyInfo.name] = keyInfo;
    }
  });
  return keysToReturn;
};

const sendRemindersForExpiredKeys = async ({
  expiredKeys,
}) => {
  console.log(expiredKeys);
  const expiredKeyMailTemplate = await readFileAsync(join(__dirname, './reminderemail.html'));
  const keyListInfo = await getKeyDetails({
    keyNames: expiredKeys,
  });
  expiredKeys.forEach((expiredKey) => {
    const compiledExpiredEmail = compile(expiredKeyMailTemplate.toString());
    if (keyListInfo[expiredKey] && keyListInfo[expiredKey].recipients) {
      console.log(`sending a mail for ${expiredKey}`);
      const htmlToSend = compiledExpiredEmail({
        recipients: keyListInfo[expiredKey].recipients.map(recipient => recipient.name).join('/'),
        keyToRotate: expiredKey,
      });
      const msg = {
        to: keyListInfo[expiredKey].recipients.map(recipient => recipient.email),
        cc: process.env.TEMP_REMINDERS_TO,
        from: process.env.EMAIL_FROM,
        replyTo: process.env.EMAIL_REPLY_TO,
        subject: '[Alert] Your AWS key requires rotation',
        text: 'please request a text version',
        html: htmlToSend,
      };
      sgMail.send(msg);
    } else {
      console.log(`Couldn't find recipient info for ${expiredKey}`);
    }
  });
};

const addKeysToLists = async ({
  now,
  inactiveKeys,
  expireSoonKeys,
  expiredKeys,
  keysToSendReminderMailsFor,
  UserName,
}) => {
  const { AccessKeyMetadata: keys } = await iam.listAccessKeys({ /* eslint no-await-in-loop: 0 */
    UserName,
  }).promise();
  keys.forEach((key) => {
    const daysOld = now.diff(moment(key.CreateDate), 'days');
    if (key.Status === 'Inactive') {
      console.log(`Found Inactive Key: ${UserName} - ${key.AccessKeyId}`);
      inactiveKeys.push({
        user: UserName,
        keyId: key.AccessKeyId,
        daysOld,
      });
    } else if (
      key.Status === 'Active'
      && daysOld > daysWarn && daysOld < daysError
    ) {
      console.log(`Found Key That Will Expire Soon: ${UserName} - ${key.AccessKeyId} - ${daysOld} days old`);
      expireSoonKeys.push({
        user: UserName,
        keyId: key.AccessKeyId,
        daysOld,
      });
    }
    if (
      key.Status === 'Active'
      && daysOld >= daysError
    ) {
      console.log(`Found Expired Key: ${UserName} - ${key.AccessKeyId} - ${daysOld} days old`);
      expiredKeys.push({
        user: UserName,
        keyId: key.AccessKeyId,
        daysOld,
      });
      if (daysOld === daysError || (daysOld - daysError) % 12 === 0) {
        console.log(`adding key reminder for ${UserName}`);
        keysToSendReminderMailsFor.push(UserName);
      }
    }
  });
};

const main = async () => {
  const now = moment();
  const inactiveKeys = [];
  const expireSoonKeys = [];
  const expiredKeys = [];
  const keysToSendReminderMailsFor = [];
  const promiseList = [];
  const { Users: users } = await iam.listUsers({}).promise();
  // audit each user's one by one
  users.map(user => user.UserName).forEach((UserName) => {
    console.log(`Auditing Keys for User: ${UserName}`);
    promiseList.push(addKeysToLists({
      now,
      inactiveKeys,
      expireSoonKeys,
      expiredKeys,
      keysToSendReminderMailsFor,
      UserName,
    }));
  });
  await Promise.all(promiseList);
  if (inactiveKeys.length || expireSoonKeys.length || expiredKeys.length) {
    sendEmail({
      inactiveKeys,
      expireSoonKeys,
      expiredKeys,
    });
  } else {
    console.log('There are no keys that require action');
  }
  if (keysToSendReminderMailsFor.length) {
    sendRemindersForExpiredKeys({
      expiredKeys: keysToSendReminderMailsFor,
    });
  }
};

try {
  main();
} catch (err) {
  console.log(err);
}
