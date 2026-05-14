'use client'

import { useState, useEffect, useRef } from 'react'

// ============================================================
// Types
// ============================================================

type Customer = {
  name: string
  phone: string
  last_address: string | null
}

type Item = {
  id: number
  name: string
  quantity: number
  price: number
}

let _itemId = 0
function makeItem(): Item {
  return { id: ++_itemId, name: '', quantity: 1, price: 0 }
}

// ============================================================
// Root — handles auth state and renders appropriate screen
// ============================================================

export default function NewOrderPage() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null)

  useEffect(() => {
    fetch('/api/admin/auth/check')
      .then((r) => r.json())
      .then((d: { authenticated: boolean }) => setAuthenticated(d.authenticated))
      .catch(() => setAuthenticated(false))
  }, [])

  if (authenticated === null) {
    return (
      <div className="min-h-screen bg-amber-50 flex items-center justify-center">
        <span className="text-amber-400 text-sm">Loading…</span>
      </div>
    )
  }

  if (!authenticated) {
    return <PasswordGate onSuccess={() => setAuthenticated(true)} />
  }

  return <OrderForm />
}

// ============================================================
// Password gate
// ============================================================

function PasswordGate({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const r = await fetch('/api/admin/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (r.ok) {
        onSuccess()
      } else {
        setError('Incorrect password')
        setPassword('')
      }
    } catch {
      setError('Connection error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-amber-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-5xl mb-4">🎂</div>
          <h1 className="text-2xl font-bold text-gray-900">Cakewalk Admin</h1>
          <p className="text-sm text-gray-500 mt-1">Order management</p>
        </div>
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm p-6 space-y-4">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoFocus
            autoComplete="current-password"
            className="w-full border border-gray-200 rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
          />
          {error && <p className="text-sm text-red-500 text-center">{error}</p>}
          <button
            type="submit"
            disabled={loading || !password}
            className="w-full bg-amber-500 hover:bg-amber-600 active:bg-amber-700 disabled:bg-amber-200 disabled:text-amber-400 text-white font-semibold py-3 rounded-xl text-base transition-colors"
          >
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ============================================================
// Order form
// ============================================================

function OrderForm() {
  // Customer search
  const [search, setSearch] = useState('')
  const [suggestions, setSuggestions] = useState<Customer[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const searchContainerRef = useRef<HTMLDivElement>(null)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Customer fields
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [deliveryAddress, setDeliveryAddress] = useState('')

  // Order fields
  const [items, setItems] = useState<Item[]>([makeItem()])
  const [paymentMethod, setPaymentMethod] = useState<'cod' | 'paid'>('cod')

  // Submission
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null)

  // Debounced customer search
  useEffect(() => {
    if (search.length < 2) {
      setSuggestions([])
      setShowSuggestions(false)
      return
    }
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/admin/customers/search?q=${encodeURIComponent(search)}`)
        if (r.ok) {
          const data: Customer[] = await r.json()
          setSuggestions(data)
          setShowSuggestions(data.length > 0)
        }
      } catch {
        // search errors are silent
      }
    }, 300)
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    }
  }, [search])

  // Close suggestions on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function selectCustomer(c: Customer) {
    setCustomerName(c.name)
    setCustomerPhone(c.phone)
    setDeliveryAddress(c.last_address ?? '')
    setSearch('')
    setShowSuggestions(false)
  }

  function addItem() {
    setItems((prev) => [...prev, makeItem()])
  }

  function removeItem(id: number) {
    setItems((prev) => prev.filter((i) => i.id !== id))
  }

  function updateItem(id: number, field: keyof Omit<Item, 'id'>, raw: string) {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item
        if (field === 'name') return { ...item, name: raw }
        if (field === 'quantity') return { ...item, quantity: Math.max(1, parseInt(raw) || 1) }
        if (field === 'price') return { ...item, price: parseFloat(raw) || 0 }
        return item
      })
    )
  }

  const total = items.reduce((sum, i) => sum + i.quantity * i.price, 0)
  const validItems = items.filter((i) => i.name.trim() && i.quantity > 0)
  const canSubmit = !submitting && customerName.trim() && customerPhone.trim() && validItems.length > 0

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return

    setSubmitting(true)
    setResult(null)

    try {
      const r = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_slug: 'cakewalk',
          external_order_id: `MANUAL-${Date.now()}`,
          customer_name: customerName.trim(),
          customer_phone: customerPhone.trim(),
          items: validItems.map(({ name, quantity, price }) => ({ name, quantity, price })),
          total_amount: total,
          currency: 'PKR',
          payment_method: paymentMethod,
          delivery_address: deliveryAddress.trim() || undefined,
        }),
      })

      if (r.ok) {
        setResult({ success: true, message: 'Order created! WhatsApp sent to customer.' })
        setCustomerName('')
        setCustomerPhone('')
        setDeliveryAddress('')
        setItems([makeItem()])
        setPaymentMethod('cod')
        setSearch('')
        setSuggestions([])
      } else {
        const d = await r.json().catch(() => ({})) as { error?: string }
        setResult({ success: false, message: d.error ?? 'Failed to create order.' })
      }
    } catch {
      setResult({ success: false, message: 'Network error. Please try again.' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-amber-50">
      <div className="max-w-lg mx-auto px-4 py-6 pb-16">

        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-xl font-bold text-gray-900">🎂 New Order</h1>
          <p className="text-sm text-gray-500 mt-0.5">Cakewalk by Iqra Saadi</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">

          {/* ── Customer ── */}
          <section className="bg-white rounded-2xl shadow-sm p-4">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              Customer
            </h2>

            {/* Autocomplete search */}
            <div className="relative mb-2" ref={searchContainerRef}>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                placeholder="Search existing customer…"
                autoComplete="off"
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
              />
              {showSuggestions && (
                <div className="absolute left-0 right-0 top-full mt-1 z-20 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
                  {suggestions.map((c) => (
                    <button
                      key={c.phone}
                      type="button"
                      // onMouseDown prevents the input blur from firing before the click
                      onMouseDown={(e) => { e.preventDefault(); selectCustomer(c) }}
                      className="w-full text-left px-4 py-3 hover:bg-amber-50 active:bg-amber-100 border-b border-gray-100 last:border-0"
                    >
                      <div className="font-medium text-gray-900 text-sm">{c.name}</div>
                      <div className="text-xs text-gray-400 mt-0.5">{c.phone}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <input
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Full name *"
              required
              autoComplete="off"
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent mb-2"
            />
            <input
              type="tel"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              placeholder="+923001234567 *"
              required
              autoComplete="off"
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent mb-2"
            />
            <textarea
              value={deliveryAddress}
              onChange={(e) => setDeliveryAddress(e.target.value)}
              placeholder="Delivery address (leave blank for pickup)"
              rows={2}
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent resize-none"
            />
          </section>

          {/* ── Items ── */}
          <section className="bg-white rounded-2xl shadow-sm p-4">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              Items
            </h2>

            <div className="space-y-3">
              {items.map((item, idx) => (
                <div key={item.id} className="bg-gray-50 rounded-xl p-3 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-gray-400 font-medium">Item {idx + 1}</span>
                    {items.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeItem(item.id)}
                        className="text-xs text-gray-400 hover:text-red-500 font-medium transition-colors"
                      >
                        Remove
                      </button>
                    )}
                  </div>

                  <input
                    type="text"
                    value={item.name}
                    onChange={(e) => updateItem(item.id, 'name', e.target.value)}
                    placeholder="Item name (e.g. Chocolate Cake)"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-base bg-white focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
                  />

                  <div className="flex gap-2 items-end">
                    <div>
                      <label className="text-xs text-gray-400 block mb-1 ml-1">Qty</label>
                      <input
                        type="number"
                        value={item.quantity}
                        onChange={(e) => updateItem(item.id, 'quantity', e.target.value)}
                        min="1"
                        inputMode="numeric"
                        className="w-20 border border-gray-200 rounded-xl px-3 py-2.5 text-base bg-white focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent text-center"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="text-xs text-gray-400 block mb-1 ml-1">Price (Rs.)</label>
                      <input
                        type="number"
                        value={item.price || ''}
                        onChange={(e) => updateItem(item.id, 'price', e.target.value)}
                        min="0"
                        inputMode="decimal"
                        placeholder="0"
                        className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-base bg-white focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
                      />
                    </div>
                    <div className="pb-2.5 text-sm text-gray-400 whitespace-nowrap">
                      = Rs. {(item.quantity * item.price).toLocaleString('en-PK')}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={addItem}
              className="mt-3 text-amber-600 hover:text-amber-700 active:text-amber-800 text-sm font-semibold flex items-center gap-1 transition-colors"
            >
              <span className="text-base leading-none">+</span> Add item
            </button>

            <div className="mt-4 pt-4 border-t border-gray-100 flex justify-between items-center">
              <span className="font-semibold text-gray-700">Total</span>
              <span className="text-xl font-bold text-gray-900">
                Rs. {Math.round(total).toLocaleString('en-PK')}
              </span>
            </div>
          </section>

          {/* ── Payment ── */}
          <section className="bg-white rounded-2xl shadow-sm p-4">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              Payment
            </h2>
            <div className="grid grid-cols-2 gap-3">
              {(['cod', 'paid'] as const).map((method) => (
                <button
                  key={method}
                  type="button"
                  onClick={() => setPaymentMethod(method)}
                  className={`py-3 rounded-xl text-sm font-semibold border-2 transition-colors ${
                    paymentMethod === method
                      ? 'border-amber-500 bg-amber-50 text-amber-700'
                      : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
                  }`}
                >
                  {method === 'cod' ? 'Cash on Delivery' : 'Paid Online'}
                </button>
              ))}
            </div>
          </section>

          {/* ── Result banner ── */}
          {result && (
            <div
              className={`rounded-2xl px-4 py-3 text-sm font-medium ${
                result.success
                  ? 'bg-green-50 text-green-700 border border-green-200'
                  : 'bg-red-50 text-red-700 border border-red-200'
              }`}
            >
              {result.message}
            </div>
          )}

          {/* ── Submit ── */}
          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full bg-amber-500 hover:bg-amber-600 active:bg-amber-700 disabled:bg-amber-200 disabled:text-amber-400 text-white font-bold py-4 rounded-2xl text-base transition-colors"
          >
            {submitting ? 'Creating Order…' : 'Create Order & Send WhatsApp'}
          </button>

        </form>
      </div>
    </div>
  )
}
