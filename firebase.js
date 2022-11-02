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
    writePbpData: (gameId, pbp) => {
        fbdb.set(fbdb.ref(database, 'gameFeed22/' + gameId + '/' + new Date().getTime()), {
          pbp
        });
      },
    writePbpData22: (gameId, pbp) => {
        fbdb.set(fbdb.ref(database, 'gamePbp22/' + gameId), {
          pbp
        });
      },
    getPbpData: (gameId) => {
        // const feed = fbdb.ref(database, 'gameFeed/' + gameId);
        // fbdb.onValue(feed, (snapshot) => {
        //     const data = snapshot.val();
        //     return data;
        // });

        const dbRef = fbdb.ref(fbdb.getDatabase());
        fbdb.get(fbdb.child(dbRef, `gameFeed/${gameId}`)).then((snapshot) => {
        if (snapshot.exists()) {
            //console.log(snapshot.val());
        } else {
            console.log("No data available");
        }
        }).catch((error) => {
            console.error(error);
        });
    },
    // writeGameData: (gameId, data) => {
    //     fbdb.set(fbdb.ref(database, 'gameData/' + gameId), {
    //       data
    //     });
    //   },
    writeGameData22: (gameId, data) => {
        fbdb.set(fbdb.ref(database, 'gameData22/' + gameId), {
          data
        });
      },
    writeGameHeader22: (gameId, data) => {
        fbdb.set(fbdb.ref(database, 'gameHeader22/' + gameId), {
          data
        });
      },
}


//writeUserData("1", "dsfsdfsdf", "sadlfkjsdlfsdjlfk");
// function writeUserData(userId, name, email) {
//   set(ref(db, 'users/' + userId), {
//     username: name,
//     email: email,
//   });
// }