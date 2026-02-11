import { useState, useEffect, useCallback } from 'react'
import './App.css'

const PRAYERS = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha']
const STORAGE_KEY = 'solat-qada-tracker'

function getDefaultPrayerData() {
  return Object.fromEntries(
    PRAYERS.map((p) => [
      p,
      { totalQada: 0, weeklyTarget: 0, completedThisWeek: 0 },
    ])
  )
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
  const [prayers, setPrayers] = useState(() => {
    const saved = loadData()
    if (saved?.prayers) return saved.prayers
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

  const resetWeek = useCallback(() => {
    setPrayers((prev) => {
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

  // Persist to localStorage
  useEffect(() => {
    saveData({ prayers, weekStartDate })
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

  return (
    <div className="app">
      <div className="app-header">
        <img src="/islamic-logo-mosque-vector.jpg" alt="Logo" className="app-logo" />
        <h1>Solat Qada Tracker</h1>
      </div>

      <div className="week-info">
        <span>Days left this week: <strong>{daysLeft}</strong></span>
        <button className="reset-btn" onClick={resetWeek}>
          Reset Week
        </button>
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
                <input
                  type="number"
                  min="0"
                  value={data.totalQada}
                  onChange={(e) => handleSetTotal(prayer, e.target.value)}
                />
              </div>

              <div className="field">
                <label>Weekly Target</label>
                <input
                  type="number"
                  min="0"
                  value={data.weeklyTarget}
                  onChange={(e) => handleSetWeeklyTarget(prayer, e.target.value)}
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
