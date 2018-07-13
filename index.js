const { join, resolve } = require('path')
require('dotenv').config({
  path: resolve(__dirname, 'env/env')
})
const { promisify } = require('util')
const { readFile } = require('fs')
const { compile } = require('handlebars')
const moment = require('moment')
const AWS = require('aws-sdk')
const sgMail = require('@sendgrid/mail')

const readFileAsync = promisify(readFile)

AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
})
const iam = new AWS.IAM()

sgMail.setApiKey(process.env.SENDGRID_API_KEY)

const daysWarn = parseInt(process.env.DAYS_WARN)
const daysError = parseInt(process.env.DAYS_ERROR)

const generateHtmlEmail = async ({
  inactiveKeys,
  expireSoonKeys,
  expiredKeys,
}) => {
  const template = await readFileAsync(join(__dirname, './summaryemail.html'))
  const compiledTemplate = compile(template.toString())
  const html = compiledTemplate({
    inactiveKeys,
    expireSoonKeys,
    expiredKeys,
    daysError,
  });
  return html
}

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
  }
  //sgMail.send(msg)
}

const getKeyDetails = async ({
  keyNames
}) => {
  const keyInfoFileContents = await readFileAsync(join(__dirname, './keys.info'))
  var keysToReturn = {}
  keyListInfo = JSON.parse(keyInfoFileContents)
  keyListInfo.keys.forEach((keyInfo) => {
    if (keyNames.indexOf(keyInfo.name) != -1) {
      keysToReturn[keyInfo.name] = keyInfo
    }
  })
  return keysToReturn
}

const sendRemindersForExpiredKeys = async({
  expiredKeys
}) => {
  console.log(expiredKeys)
  expiredKeyMailTemplate = await readFileAsync(join(__dirname, './reminderemail.html'))
  keyListInfo = await getKeyDetails({
    keyNames: expiredKeys,
  })
  
  expiredKeys.forEach((expiredKey) => {
    
    var compiledExpiredEmail = compile(expiredKeyMailTemplate.toString())
    if (keyListInfo[expiredKey] && keyListInfo[expiredKey].recipients){
      console.log("sending a mail for " + expiredKey)
      var htmlToSend = compiledExpiredEmail({
        recipients: keyListInfo[expiredKey].recipients.map(recipient => {return recipient.name}).join("/"),
        keyToRotate: expiredKey
      })
      var msg = {
        to: keyListInfo[expiredKey].recipients.map(recipient => {return recipient.email}),
        cc: process.env.TEMP_REMINDERS_TO,
        from: process.env.EMAIL_FROM,
        replyTo: process.env.EMAIL_REPLY_TO,
        subject: `[Alert] Your AWS key requires rotation`,
        text: 'please request a text version',
        html: htmlToSend
      }
      sgMail.send(msg)
    } else {
      console.log("Couldn't find recipient info for " + expiredKey)
    }
    
  })

}
const main = async () => {
  const now = moment()
  const inactiveKeys = []
  const expireSoonKeys = []
  const expiredKeys = []
  const keysToSendReminderMailsFor = []
  const { Users: users} = await iam.listUsers({}).promise()
  stopChecking = false
  // audit each user's one by one
  for (const UserName of users.map(user => user.UserName)) {
    console.log(`Auditing Keys For User: ${UserName}`)
    const { AccessKeyMetadata: keys } = await iam.listAccessKeys({
      UserName
    }).promise()
    keys.forEach((key) => {
      const daysOld = now.diff(moment(key.CreateDate), 'days')
      if (key.Status === 'Inactive') {
        console.log(`Found Inactive Key: ${UserName} - ${key.AccessKeyId}`);
        inactiveKeys.push({
          user: UserName,
          keyId: key.AccessKeyId,
          daysOld,
        })
      } else if (
        key.Status === 'Active' &&
        daysOld > daysWarn && daysOld < daysError
      ) {
        console.log(`Found Key That Will Expire Soon: ${UserName} - ${key.AccessKeyId} - ${daysOld} days old`)
        expireSoonKeys.push({
          user: UserName,
          keyId: key.AccessKeyId,
          daysOld,
        })
      }
      if (
        key.Status === 'Active' &&
        daysOld >= daysError
      ) {
        console.log(`Found Expired Key: ${UserName} - ${key.AccessKeyId} - ${daysOld} days old`)
        expiredKeys.push({
          user: UserName,
          keyId: key.AccessKeyId,
          daysOld,
        })
        if (daysOld == daysError || (daysOld-daysError)%8== 0) {
          console.log("adding key reminder for " + UserName)
          keysToSendReminderMailsFor.push(UserName)
        }
      }
    })
  }
  if (inactiveKeys.length || expireSoonKeys.length || expiredKeys.length) {
    await sendEmail({
      inactiveKeys,
      expireSoonKeys,
      expiredKeys,
    })
  } else {
      console.log('There are no keys that require action')
  }
  if (keysToSendReminderMailsFor.length) {
    await sendRemindersForExpiredKeys({
      expiredKeys: keysToSendReminderMailsFor
    })
  }
}

try {
  main()
} catch (err) {
  console.log(err)
}
