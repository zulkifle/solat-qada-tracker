import { initializeApp } from "firebase/app"
import { getFirestore, doc, getDoc, setDoc } from "firebase/firestore"

const firebaseConfig = {
  apiKey: "AIzaSyBsstBgdZHe8K68iPBODojf1ym-2HTCAew",
  authDomain: "solat-qada-tracker-34d1e.firebaseapp.com",
  projectId: "solat-qada-tracker-34d1e",
  storageBucket: "solat-qada-tracker-34d1e.firebasestorage.app",
  messagingSenderId: "1071838243016",
  appId: "1:1071838243016:web:955558ee040aad4ca29dfd",
  measurementId: "G-F2X25ZSX88"
}

const app = initializeApp(firebaseConfig)
const db = getFirestore(app)

function getUserDoc(username) {
  return doc(db, "users", username.toLowerCase())
}

export async function loginUser(username, pin) {
  const snap = await getDoc(getUserDoc(username))
  if (!snap.exists()) return { success: false, error: 'User not found' }
  const data = snap.data()
  if (data.pin !== pin) return { success: false, error: 'Wrong PIN' }
  return { success: true, data: data.tracker }
}

export async function registerUser(username, pin) {
  const snap = await getDoc(getUserDoc(username))
  if (snap.exists()) return { success: false, error: 'Username already taken' }
  await setDoc(getUserDoc(username), { pin, tracker: null })
  return { success: true }
}

export async function loadFromFirestore(username) {
  const snap = await getDoc(getUserDoc(username))
  if (snap.exists()) return snap.data().tracker
  return null
}

export async function saveToFirestore(username, data) {
  const ref = getUserDoc(username)
  const snap = await getDoc(ref)
  const existing = snap.exists() ? snap.data() : {}
  await setDoc(ref, { ...existing, tracker: data })
}
