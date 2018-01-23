require('dotenv').config()
const moment = require('moment')
const AWS = require('aws-sdk')

AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
})

const daysWarn = parseInt(process.env.DAYS_WARN)
const daysError = parseInt(process.env.DAYS_ERROR)

const iam = new AWS.IAM()

const main = async () => {
  const now = moment()
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
      } else if (
        key.Status === 'Active' &&
        daysOld > daysWarn
      ) {
        console.log(`Found Key > ${daysWarn} days: ${UserName} - ${key.AccessKeyId} - ${daysOld} days old`)
      }
      if (
        key.Status === 'Active' &&
        daysOld > daysError
      ) {
        console.log(`Found Key > ${daysError} days: ${UserName} - ${key.AccessKeyId} - ${daysOld} days old`)
      }
    })
  }

}

try {
  main()
} catch (err) {
  console.log(err)
}
