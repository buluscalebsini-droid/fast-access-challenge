// ============================================================
// firebase.js — Firebase configuration
// Replace the config object below with YOUR Firebase project keys.
// Get them from: Firebase Console → Project Settings → Your apps → SDK setup
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, set, get, update, onValue, onDisconnect, serverTimestamp, off, remove, push, child }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { getAuth, signInAnonymously, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// ⚠️  REPLACE THIS WITH YOUR FIREBASE CONFIG
// const firebaseConfig = {
//   apiKey: "YOUR_API_KEY",
//   authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
//   databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
//   projectId: "YOUR_PROJECT_ID",
//   storageBucket: "YOUR_PROJECT_ID.appspot.com",
//   messagingSenderId: "YOUR_SENDER_ID",
//   appId: "YOUR_APP_ID"
// };

const firebaseConfig = {
  "type": "service_account",
  "project_id": "poland-26",
  "private_key_id": "02add849de6cea91900fb91a6e771d5a79a3090f",
  "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDnsAmMB0u977x7\n3EEmP6KC0ejfRnVQs9k8rvRFeB4NvuF50y6Alybxvdiwf+1POXU9tFSvHxX/FEKK\nY2n6s9dktb2w3CvvQhnfHDQM64cidio1CSC9yvL342kRlED/c61o8juuZumnStoK\nqru359SbZiVX6gM2QzQo3XD2aRnn6ad/LzQG6Vuar9TRWqc9Fpl8b44+r0fGz4cY\nQJcWLNC8+6jo4AAsIn/YOJR149eQpoSnAsC44VF9oUPXcHYsleOxv082o/s9Mz9E\nw2zbs7mX4gnXynQzylu39xilAYmMg7xgnbdbCMyGMjIF5dpf6iut49+RN5dPJyYs\nxbLhsemrAgMBAAECggEADR6Du+Eh4dR0aNMVAVRzIFNAi3wS4on8kBocDN77XK3l\nWJ+jr3Zfpyqn3X6w8l5/jAntDamF9lawWeO9OYv7c2FzJ1OgTUEB9AdFz0F6+nGU\nfEJTD0wxq+W9qlgpwg1L0Xh99qcvLeDoLdhzHrvK5y3GiY7fta/igTngzqMu61nN\nI+QyXa1/54fiRmbkIQ6a0akwl8AcZLoFWQrt8FYQcQgI4MZyl4m05Ut70D0YO6wo\n80504ZEvfCuIgRaJ9RECRFMC3bjB4zZK9o7H/+8BRZCU5JL406RIwWXKF25sb1dz\nXtXDE33OKMSpw98ZieFigdwYFIKLmj2DZasCa6fvcQKBgQD2r4oDgS8URimRhygF\nljY6a4Nf5ZOtULdl9ZXxv23SRg4JDv0mfTBFYWWOfPKonqOqDHuD0pS0EqK8iQSv\ngG+0t2s8JMS9DrEXAIZfQ9HSm7JFssAhFZmNQh8St6h9NKTdRWlB9dkOB0mbLZQ3\nPsQjKP0dkKM6PlJOBdzELeu5EwKBgQDwb4b07cPTx5rDt/ClYW2FeM/hTAVzFSSc\nRITGXSlQV5ObPgdRTYUidSR8b/Ivg2cLey5xQcSBdHGd0j8j5a8ptkp4+k4yP+FG\nN0mAMg/DNkgEW69gQGYsO07HsDFA7OJXMBkT+OO/bATnqFC2TvWUZuu6lEzjZIBL\nexyGxCr4CQKBgHVOooXqH7Y3azsOF6UYem8rg0zOAnzvnlb5AzXzv0i4EaKTIyTz\ncUn89+tbVZWD4vZRe0cDk71SA1s+mSDQJc69TlxKa9gvrVzv3fZdbOEHMy5bw2u4\nNs3qvJYNCi2IJEIo6NX6EB7QrlsBwLLIwUKrEjrF9ikTS9ZYiVQtNiRLAoGAUeDJ\nBrPJkl9RFwGW09r/3worUMAAwxYaJ5U12g9zuEZ6n81Z1JgflIJr8Gx2/zMybjh+\nslcBQkyTPHmSwvi+0+eeKOCkrHwQjUbaoutpbsMXd1R5vr9vi/SOeXZI76E72xEo\nGSMS++cfLHynL85n1yfNcvZ50J4zCoFcT5CSSXECgYEA0+I7x7D3pbdmzeIdfC6Z\nHBGIOWq4sUKueR/Jd5MbNQDes/B8wIhQXKvNO92phr9pG4u0SNQT+WrnYt2cyU2j\nryBkB2zxSQiaXOWobqteEEeDmUguUDQS9YArP2ZuYhlxu+AkG8PA3CQduCcoZPsq\nkUJ+U6ePgg+wBe9LJThlWe4=\n-----END PRIVATE KEY-----\n",
  "client_email": "firebase-adminsdk-fbsvc@poland-26.iam.gserviceaccount.com",
  "client_id": "111891932983050608992",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-fbsvc%40poland-26.iam.gserviceaccount.com",
  "universe_domain": "googleapis.com"
}

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);

export { db, auth, ref, set, get, update, onValue, onDisconnect, serverTimestamp, off, remove, push, child, signInAnonymously, onAuthStateChanged };
