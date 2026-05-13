import { google, sheets_v4 } from 'googleapis'

let _sheets: sheets_v4.Sheets | null = null

export function getSheetsClient(): sheets_v4.Sheets {
  if (_sheets) return _sheets

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY

  if (!email) throw new Error('GOOGLE_SERVICE_ACCOUNT_EMAIL is not set')
  if (!rawKey) throw new Error('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY is not set')

  // Normalise both formats: Vercel stores real newlines, local .env.local stores literal \n
  const privateKey = rawKey.replace(/\\n/g, '\n')

  const auth = new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })

  _sheets = google.sheets({ version: 'v4', auth })
  return _sheets
}
