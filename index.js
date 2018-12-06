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

// AWS.config.update({
//   accessKeyId: process.env.AWS_ACCESS_KEY_ID,
//   secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
// })
const iam = new AWS.IAM()

sgMail.setApiKey(process.env.SENDGRID_API_KEY)

const daysWarn = parseInt(process.env.DAYS_WARN)
const daysError = parseInt(process.env.DAYS_ERROR)

const generateHtmlEmail = async ({
  inactiveKeys,
  expireSoonKeys,
  expiredKeys,
}) => {
  const template = await readFileAsync(join(__dirname, './email.html'))
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
  sgMail.send(msg)
}

const main = async () => {
  const now = moment()
  const inactiveKeys = []
  const expireSoonKeys = []
  const expiredKeys = []
  const { Users: users} = await iam.listUsers({}).promise()
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
        daysOld > daysWarn && daysOld <= daysError
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
        daysOld > daysError
      ) {
        console.log(`Found Expired Key: ${UserName} - ${key.AccessKeyId} - ${daysOld} days old`)
        expiredKeys.push({
          user: UserName,
          keyId: key.AccessKeyId,
          daysOld,
        })
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
}

try {
  main()
} catch (err) {
  console.log(err)
}
