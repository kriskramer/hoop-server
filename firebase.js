// https://firebase.google.com/docs/web/setup#available-libraries
const fb = require('firebase/app');
const fbdb = require("firebase/database");

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyC4iT8U8r7x74mQwgWTVm_TdrWSIKMPRAY",
  authDomain: "hoopfan-26b24.firebaseapp.com",
  projectId: "hoopfan-26b24",
  storageBucket: "hoopfan-26b24.appspot.com",
  messagingSenderId: "505467317877",
  appId: "1:505467317877:web:14f5d457b513cd5063923c",
  measurementId: "G-7BRKTFSYEF"
};

// Initialize Firebase
const app = fb.initializeApp(firebaseConfig);

// Get a reference to the database service
const database = fbdb.getDatabase(app);

module.exports = {
    writePbpData: (gameId, period, pbp) => {
        fbdb.set(fbdb.ref(database, 'gameFeed/' + gameId + '/' + new Date().getTime()), {
          period: period,
          clock: pbp.clock,
          description: pbp.description,
          hTeamScore: pbp.hTeamScore,
          vTeamScore: pbp.vTeamScore,
          eventMsgType: pbp.eventMsgType,
          personId: pbp.personId,
          teamId: pbp.teamId,
          isScoreChange: pbp.isScoreChange,
          isVideoAvailable: pbp.isVideoAvailable,
          formatted: pbp.formatted
        });
      }
}


//writeUserData("1", "dsfsdfsdf", "sadlfkjsdlfsdjlfk");
// function writeUserData(userId, name, email) {
//   set(ref(db, 'users/' + userId), {
//     username: name,
//     email: email,
//   });
// }