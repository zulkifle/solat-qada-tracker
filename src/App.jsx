import { useState, useEffect, useCallback, useRef } from 'react'
import emailjs from '@emailjs/browser'
import { loadFromFirestore, saveToFirestore, loginUser, registerUser } from './firebase'
import './App.css'

const PRAYERS = ['Subuh', 'Zohor', 'Asar', 'Maghrib', 'Isyak']
const STORAGE_KEY = 'solat-qada-tracker'
const EMAIL_SENT_KEY = 'solat-qada-email-sent'

const EMAILJS_SERVICE_ID = 'service_8vtayrw'
const EMAILJS_TEMPLATE_ID = 'template_u4lr9tr'
const EMAILJS_PUBLIC_KEY = 'ddx1dLrvc06mPJ8xW'

const OLD_TO_NEW = {
  Fajr: 'Subuh',
  Dhuhr: 'Zohor',
  Asr: 'Asar',
  Maghrib: 'Maghrib',
  Isha: 'Isyak',
}

function getDefaultPrayerData() {
  return Object.fromEntries(
    PRAYERS.map((p) => [
      p,
      { totalQada: 0, weeklyTarget: 0, completedThisWeek: 0 },
    ])
  )
}

function migratePrayerNames(data) {
  if (!data) return null
  const hasAllNewKeys = PRAYERS.every((p) => data[p])
  if (hasAllNewKeys) return data
  const hasOldKeys = ['Fajr', 'Dhuhr', 'Asr', 'Isha'].some((k) => data[k])
  if (!hasOldKeys) return data
  const migrated = {}
  for (const [oldKey, newKey] of Object.entries(OLD_TO_NEW)) {
    migrated[newKey] = data[oldKey] || { totalQada: 0, weeklyTarget: 0, completedThisWeek: 0 }
  }
  return migrated
}

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function saveData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

function getDaysLeftInWeek(weekStartDate) {
  const now = new Date()
  const start = new Date(weekStartDate)
  const elapsed = Math.floor((now - start) / (1000 * 60 * 60 * 24))
  return Math.max(0, 7 - elapsed)
}

function shouldAutoReset(weekStartDate) {
  return getDaysLeftInWeek(weekStartDate) === 0
}

function App() {
  const [currentUser, setCurrentUser] = useState(() => {
    return localStorage.getItem('solat-qada-user') || null
  })
  const [loginUsername, setLoginUsername] = useState('')
  const [loginPin, setLoginPin] = useState('')
  const [loginError, setLoginError] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)
  const [isRegisterMode, setIsRegisterMode] = useState(false)

  const [prayers, setPrayers] = useState(() => {
    const saved = loadData()
    if (saved?.prayers) return migratePrayerNames(saved.prayers) || getDefaultPrayerData()
    return getDefaultPrayerData()
  })

  const [weekStartDate, setWeekStartDate] = useState(() => {
    const saved = loadData()
    if (saved?.weekStartDate) return saved.weekStartDate
    return new Date().toISOString()
  })

  const [todayInput, setTodayInput] = useState(
    Object.fromEntries(PRAYERS.map((p) => [p, '']))
  )

  const [editingTotal, setEditingTotal] = useState(
    Object.fromEntries(PRAYERS.map((p) => [p, false]))
  )
  const [syncStatus, setSyncStatus] = useState('loading')
  const skipNextSync = useRef(false)

  async function handleLogin() {
    if (!loginUsername.trim() || !loginPin.trim()) {
      setLoginError('Please enter username and PIN')
      return
    }
    setLoginLoading(true)
    setLoginError('')
    try {
      const result = await loginUser(loginUsername.trim(), loginPin.trim())
      if (!result.success) {
        setLoginError(result.error)
        setLoginLoading(false)
        return
      }
      const username = loginUsername.trim().toLowerCase()
      localStorage.setItem('solat-qada-user', username)
      setCurrentUser(username)
      if (result.data?.prayers) {
        const migrated = migratePrayerNames(result.data.prayers) || result.data.prayers
        skipNextSync.current = true
        setPrayers(migrated)
        if (result.data.weekStartDate) setWeekStartDate(result.data.weekStartDate)
        saveData({ prayers: migrated, weekStartDate: result.data.weekStartDate })
      }
      setSyncStatus('synced')
    } catch (err) {
      setLoginError('Connection failed. Try again.')
      console.error(err)
    }
    setLoginLoading(false)
  }

  async function handleRegister() {
    if (!loginUsername.trim() || !loginPin.trim()) {
      setLoginError('Please enter username and PIN')
      return
    }
    if (loginPin.trim().length < 4) {
      setLoginError('PIN must be at least 4 characters')
      return
    }
    setLoginLoading(true)
    setLoginError('')
    try {
      const result = await registerUser(loginUsername.trim(), loginPin.trim())
      if (!result.success) {
        setLoginError(result.error)
        setLoginLoading(false)
        return
      }
      const username = loginUsername.trim().toLowerCase()
      localStorage.setItem('solat-qada-user', username)
      setCurrentUser(username)
      setPrayers(getDefaultPrayerData())
      setWeekStartDate(new Date().toISOString())
      setSyncStatus('synced')
    } catch (err) {
      setLoginError('Connection failed. Try again.')
      console.error(err)
    }
    setLoginLoading(false)
  }

  function handleLogout() {
    localStorage.removeItem('solat-qada-user')
    setCurrentUser(null)
    setLoginUsername('')
    setLoginPin('')
    setLoginError('')
    setSyncStatus('loading')
  }

  // Load from Firestore on mount (when user is already logged in)
  useEffect(() => {
    if (!currentUser) return
    loadFromFirestore(currentUser).then((data) => {
      if (data?.prayers) {
        const migrated = migratePrayerNames(data.prayers) || data.prayers
        skipNextSync.current = true
        setPrayers(migrated)
        if (data.weekStartDate) setWeekStartDate(data.weekStartDate)
        saveData({ prayers: migrated, weekStartDate: data.weekStartDate })
      }
      setSyncStatus('synced')
    }).catch((err) => {
      console.error('Firestore load failed:', err)
      setSyncStatus('offline')
    })
  }, [currentUser])

  function sendBackupEmail(prayerData, skipGuard) {
    if (!skipGuard) {
      const lastSentWeek = localStorage.getItem(EMAIL_SENT_KEY)
      const currentWeek = new Date().toISOString().slice(0, 10)
      if (lastSentWeek === currentWeek) return
    }

    const currentDate = new Date().toISOString().slice(0, 10)
    const summary = PRAYERS.map((p) => {
      const d = prayerData[p]
      return `${p}: ${d.completedThisWeek} completed | ${d.totalQada} remaining`
    }).join('\n')

    emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
      subject: `Solat Qada Weekly Backup - ${currentDate}`,
      message: `Hi Zulkifle Muhammad,\n\nThis is your weekly Qada Solat backup.\n\n--- Weekly Summary ---\n${summary}\n\n--- Full Backup Data ---\n${JSON.stringify({ prayers: prayerData }, null, 2)}\n\nBest regards,\nMyDear Self`,
    }, EMAILJS_PUBLIC_KEY).then(
      () => {
        localStorage.setItem(EMAIL_SENT_KEY, currentDate)
        alert('Backup email sent successfully!')
      },
      (err) => {
        console.error('Email failed:', err)
        alert('Email failed: ' + (err?.text || err?.message || JSON.stringify(err)))
      }
    )
  }

  const resetWeek = useCallback(() => {
    setPrayers((prev) => {
      // sendBackupEmail(prev, false)
      const updated = { ...prev }
      for (const p of PRAYERS) {
        updated[p] = { ...updated[p], completedThisWeek: 0 }
      }
      return updated
    })
    setWeekStartDate(new Date().toISOString())
  }, [])

  // Auto-reset check
  useEffect(() => {
    if (shouldAutoReset(weekStartDate)) {
      resetWeek()
    }
  }, [weekStartDate, resetWeek])

  // Persist to localStorage + Firestore
  useEffect(() => {
    saveData({ prayers, weekStartDate })
    if (skipNextSync.current) {
      skipNextSync.current = false
      return
    }
    if (!currentUser) return
    saveToFirestore(currentUser, { prayers, weekStartDate }).then(() => {
      setSyncStatus('synced')
    }).catch((err) => {
      console.error('Firestore save failed:', err)
      setSyncStatus('offline')
    })
  }, [prayers, weekStartDate])

  function handleSetTotal(prayer, value) {
    const num = Math.max(0, parseInt(value) || 0)
    setPrayers((prev) => ({
      ...prev,
      [prayer]: { ...prev[prayer], totalQada: num },
    }))
  }

  function handleSetWeeklyTarget(prayer, value) {
    const num = Math.max(0, parseInt(value) || 0)
    setPrayers((prev) => ({
      ...prev,
      [prayer]: { ...prev[prayer], weeklyTarget: num },
    }))
  }

  function handleTodayInputChange(prayer, value) {
    setTodayInput((prev) => ({ ...prev, [prayer]: value }))
  }

  function handleAddCompleted(prayer) {
    const num = Math.max(0, parseInt(todayInput[prayer]) || 0)
    if (num === 0) return
    setPrayers((prev) => ({
      ...prev,
      [prayer]: {
        ...prev[prayer],
        totalQada: Math.max(0, prev[prayer].totalQada - num),
        completedThisWeek: prev[prayer].completedThisWeek + num,
      },
    }))
    setTodayInput((prev) => ({ ...prev, [prayer]: '' }))
  }

  function handleExport() {
    const data = JSON.stringify({ prayers, weekStartDate }, null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `solat-qada-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleImport(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const imported = JSON.parse(evt.target.result)
        if (imported?.prayers) setPrayers(imported.prayers)
        if (imported?.weekStartDate) setWeekStartDate(imported.weekStartDate)
      } catch {
        alert('Invalid backup file.')
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const daysLeft = getDaysLeftInWeek(weekStartDate)

  function isWarning(prayer) {
    const data = prayers[prayer]
    return (
      daysLeft <= 2 &&
      data.weeklyTarget > 0 &&
      data.completedThisWeek < data.weeklyTarget
    )
  }

  function getProgress(prayer) {
    const data = prayers[prayer]
    if (data.weeklyTarget === 0) return 0
    return Math.min(100, Math.round((data.completedThisWeek / data.weeklyTarget) * 100))
  }

  if (!currentUser) {
    return (
      <div className="app">
        <div className="app-header">
          <img src="/islamic-logo-mosque-vector.jpg" alt="Logo" className="app-logo" />
          <h1>Solat Qada Tracker</h1>
        </div>
        <div className="login-card">
          <h2>{isRegisterMode ? 'Register' : 'Login'}</h2>
          <div className="field">
            <label>Username</label>
            <input
              type="text"
              value={loginUsername}
              onChange={(e) => setLoginUsername(e.target.value)}
              placeholder="Enter username"
              onKeyDown={(e) => {
                if (e.key === 'Enter') isRegisterMode ? handleRegister() : handleLogin()
              }}
            />
          </div>
          <div className="field">
            <label>PIN</label>
            <input
              type="password"
              value={loginPin}
              onChange={(e) => setLoginPin(e.target.value)}
              placeholder="Enter PIN"
              onKeyDown={(e) => {
                if (e.key === 'Enter') isRegisterMode ? handleRegister() : handleLogin()
              }}
            />
          </div>
          {loginError && <p className="login-error">{loginError}</p>}
          <button
            className="login-btn"
            onClick={isRegisterMode ? handleRegister : handleLogin}
            disabled={loginLoading}
          >
            {loginLoading ? 'Please wait...' : isRegisterMode ? 'Register' : 'Login'}
          </button>
          <p className="login-toggle">
            {isRegisterMode ? 'Already have an account?' : 'New user?'}{' '}
            <button onClick={() => { setIsRegisterMode(!isRegisterMode); setLoginError('') }}>
              {isRegisterMode ? 'Login' : 'Register'}
            </button>
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <div className="app-header">
        <img src="/islamic-logo-mosque-vector.jpg" alt="Logo" className="app-logo" />
        <h1>Solat Qada Tracker</h1>
        <div className="user-info">
          <span>{currentUser}</span>
          <button className="logout-btn" onClick={handleLogout}>Logout</button>
        </div>
      </div>

      <div className="week-info">
        <span>Days left this week: <strong>{daysLeft}</strong></span>
        <span className={`sync-status ${syncStatus}`}>
          {syncStatus === 'synced' ? 'Synced' : syncStatus === 'loading' ? 'Loading...' : 'Offline'}
        </span>
        <button className="reset-btn" onClick={resetWeek}>
          Reset Week
        </button>
        <button className="export-btn" onClick={handleExport}>
          Export
        </button>
        <label className="import-btn">
          Import
          <input type="file" accept=".json" onChange={handleImport} hidden />
        </label>
      </div>

      <div className="prayers-grid">
        {PRAYERS.map((prayer) => {
          const data = prayers[prayer]
          const progress = getProgress(prayer)
          const warn = isWarning(prayer)

          return (
            <div
              key={prayer}
              className={`prayer-card${warn ? ' warning' : ''}${data.totalQada === 0 ? ' completed-all' : ''}`}
            >
              <h2>{prayer}</h2>

              <div className="field">
                <label>Total Qada Remaining</label>
                <div className="input-row">
                  <input
                    type="number"
                    min="0"
                    value={data.totalQada}
                    onChange={(e) => handleSetTotal(prayer, e.target.value)}
                    onBlur={(e) => { e.target.value = data.totalQada }}
                    disabled={!editingTotal[prayer]}
                  />
                  <button
                    className={editingTotal[prayer] ? 'save-btn' : 'edit-btn'}
                    onClick={() => setEditingTotal((prev) => ({ ...prev, [prayer]: !prev[prayer] }))}
                  >
                    {editingTotal[prayer] ? 'Save' : 'Edit'}
                  </button>
                </div>
              </div>

              <div className="field">
                <label>Weekly Target</label>
                <input
                  type="number"
                  min="0"
                  value={data.weeklyTarget}
                  onChange={(e) => handleSetWeeklyTarget(prayer, e.target.value)}
                  onBlur={(e) => { e.target.value = data.weeklyTarget }}
                />
              </div>

              <div className="field add-field">
                <label>Completed Today</label>
                <div className="input-row">
                  <input
                    type="number"
                    min="0"
                    placeholder="0"
                    value={todayInput[prayer]}
                    onChange={(e) =>
                      handleTodayInputChange(prayer, e.target.value)
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleAddCompleted(prayer)
                    }}
                  />
                  <button onClick={() => handleAddCompleted(prayer)}>Add</button>
                </div>
              </div>

              {data.weeklyTarget > 0 && (
                <div className="progress-section">
                  <div className="progress-header">
                    <span>
                      {data.completedThisWeek} / {data.weeklyTarget}
                    </span>
                    <span>{progress}%</span>
                  </div>
                  <div className="progress-bar">
                    <div
                      className="progress-fill"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              )}

              {warn && (
                <p className="warning-msg">
                  Less than 2 days left — you're behind on your {prayer} target!
                </p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default App
