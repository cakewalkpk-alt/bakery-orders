import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!url || !key) {
  console.error('ERROR: Missing env vars.')
  console.error('  NEXT_PUBLIC_SUPABASE_URL:', url ? 'set' : 'MISSING')
  console.error('  NEXT_PUBLIC_SUPABASE_ANON_KEY:', key ? 'set' : 'MISSING')
  process.exit(1)
}

const supabase = createClient(url, key)

const { error } = await supabase.auth.getSession()

if (error) {
  console.error('Connection failed:', error.message)
  process.exit(1)
}

console.log('Connection successful')
console.log('  URL:', url)
