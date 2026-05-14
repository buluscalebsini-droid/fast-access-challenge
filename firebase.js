import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, set, get, update, onValue, onDisconnect, serverTimestamp, off, remove, push, child }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { getAuth, signInAnonymously, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
 
// ⚠️  Uzupełnij 3 brakujące wartości z Firebase Console → Project Settings → Your apps
const firebaseConfig = {
  apiKey: "AIzaSyBKhynneokgOpHtCqlOOADe8VT_HmvPVRA",
  authDomain: "poland-26.firebaseapp.com",
  databaseURL: "https://poland-26-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "poland-26",
  storageBucket: "poland-26.firebasestorage.app",
  messagingSenderId: "108764727439",
  appId: "1:108764727439:web:6c0bcebbf7a27f58f388fa"
};
 
const app = initializeApp(firebaseConfig);
const db  = getDatabase(app);
const auth = getAuth(app);
 
export { db, auth, ref, set, get, update, onValue, onDisconnect, serverTimestamp, off, remove, push, child, signInAnonymously, onAuthStateChanged };
