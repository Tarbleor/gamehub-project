console.log("script.js chargé")

// Configuration de base
const BASE_URL = "http://localhost:3000"

// Variables globales
let socket
let socketConnected = false
let user = null
let token = localStorage.getItem("jwt_token")
let currentGame, gameState, roomId, mode, playerSymbol
const localGameState = {
  board: [],
  currentPlayer: "X",
  gameOver: false,
  scoreX: Number.parseInt(localStorage.getItem("scoreX")) || 0,
  scoreO: Number.parseInt(localStorage.getItem("scoreO")) || 0,
}
const stats = {
  wins: Number.parseInt(localStorage.getItem("wins")) || 0,
  losses: Number.parseInt(localStorage.getItem("losses")) || 0,
}
let isProcessing = false
let difficulty = localStorage.getItem("difficulty") || "medium"
let onlineGameActive = false
let waitingForOpponent = false
let soundEnabled = localStorage.getItem("soundEnabled") !== "false"
let musicEnabled = localStorage.getItem("musicEnabled") === "true"
let volume = Number.parseInt(localStorage.getItem("volume")) || 50
let currentTheme = localStorage.getItem("theme") || "dark"
const typingTimeout = null
const confettiColors = ["#7e22ce", "#a855f7", "#10b981", "#ef4444", "#f59e0b"]
let achievements = []
let gameHistory = []
let currentTutorialStep = 0
let tutorialSteps = {}

// Sons
const sounds = {
  click: new Audio("sounds/click.mp3"),
  win: new Audio("sounds/win.mp3"),
  lose: new Audio("sounds/lose.mp3"),
  draw: new Audio("sounds/draw.mp3"),
  notification: new Audio("sounds/notification.mp3"),
  move: new Audio("sounds/move.mp3"),
  bgMusic: new Audio("sounds/background.mp3"),
}

// Initialiser les sons
Object.values(sounds).forEach((sound) => {
  sound.volume = volume / 100
})

sounds.bgMusic.loop = true

// Fonction pour jouer un son
function playSound(soundName) {
  if (!soundEnabled && soundName !== "bgMusic") return
  if (!musicEnabled && soundName === "bgMusic") return

  try {
    sounds[soundName].currentTime = 0
    sounds[soundName].play().catch((err) => console.warn("Erreur de lecture audio:", err))
  } catch (error) {
    console.warn("Erreur de son:", error)
  }
}

// Fonction pour mettre à jour le volume
function updateVolume() {
  Object.values(sounds).forEach((sound) => {
    sound.volume = volume / 100
  })
  localStorage.setItem("volume", volume)
}

// Ajoutons une fonction de débogage pour aider à diagnostiquer les problèmes de réseau
function debugNetworkRequest(url, options = {}) {
  console.group(`Requête réseau: ${options.method || "GET"} ${url}`)
  console.log("Options:", options)

  return fetch(url, options)
    .then((response) => {
      console.log("Statut:", response.status, response.statusText)
      console.log("Headers:", Object.fromEntries([...response.headers.entries()]))

      // Clonons la réponse pour pouvoir l'inspecter sans la consommer
      const clonedResponse = response.clone()

      // Tentons de lire le corps comme texte pour le débogage
      return clonedResponse.text().then((text) => {
        try {
          // Essayons de parser comme JSON
          const json = JSON.parse(text)
          console.log("Corps (JSON):", json)
        } catch (e) {
          // Si ce n'est pas du JSON, affichons le texte brut
          console.log("Corps (texte):", text.substring(0, 500) + (text.length > 500 ? "..." : ""))
        }
        console.groupEnd()
        return response // Retournons la réponse originale
      })
    })
    .catch((error) => {
      console.error("Erreur réseau:", error)
      console.groupEnd()
      throw error // Propageons l'erreur
    })
}

// Fonction pour vérifier l'état du serveur avec plus de détails
async function checkServerDetailed() {
  try {
    console.log("Vérification détaillée du serveur...")
    const response = await debugNetworkRequest(`${BASE_URL}/api/health-check`)

    if (response.ok) {
      console.log("Serveur disponible et fonctionnel")
      return true
    } else {
      throw new Error(`Serveur non disponible (${response.status}: ${response.statusText})`)
    }
  } catch (error) {
    console.error("Erreur lors de la vérification du serveur:", error)
    showNotification(`Impossible de se connecter au serveur: ${error.message}`, "error")
    return false
  }
}

// Vérifier la disponibilité du serveur
async function checkServer() {
  try {
    const response = await fetch(`${BASE_URL}/api/health-check`)
    if (response.ok) {
      console.log("Serveur disponible")
      return true
    } else {
      throw new Error("Serveur non disponible")
    }
  } catch (error) {
    console.error("Erreur lors de la vérification du serveur:", error)
    showNotification("Impossible de se connecter au serveur. Vérifiez qu'il est démarré.", "error")
    return false
  }
}

// Initialisation de Socket.IO
function initializeSocketIO() {
  try {
    if (typeof io !== "undefined") {
      console.log("Socket.IO trouvé, tentative de connexion...")
      socket = io(BASE_URL, {
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        auth: { token },
        transports: ["websocket", "polling"],
      })

      socket.on("connect", () => {
        console.log("Connecté à Socket.IO")
        socketConnected = true
        showNotification("Connecté au serveur. Mode en ligne disponible.", "success")
      })

      socket.on("connect_error", (err) => {
        console.error("Erreur Socket.IO:", err.message)
        socketConnected = false
        showNotification(
          `Erreur de connexion au serveur: ${err.message}. Vérifiez que le serveur est démarré.`,
          "error",
        )
      })

      socket.on("authenticated", ({ message }) => {
        console.log("Socket.IO authentifié:", message)
        if (token) {
          fetchUserData()
        }
      })

      socket.on("auth_error", ({ message }) => {
        console.error("Erreur d'authentification Socket.IO:", message)
        showNotification(`Erreur d'authentification: ${message}`, "error")
        localStorage.removeItem("jwt_token")
        token = null
        user = null
        updateAuthUI()
      })

      // Événements de jeu
      setupSocketGameEvents()
    } else {
      console.warn(
        "Socket.IO non disponible. Vérifiez que <script src='/socket.io/socket.io.js'> est inclus dans index.html.",
      )
      showNotification("Mode en ligne indisponible. Socket.IO non chargé.", "error")
    }
  } catch (error) {
    console.error("Erreur lors de l'initialisation de Socket.IO:", error)
    showNotification(`Erreur d'initialisation du mode en ligne: ${error.message}`, "error")
  }
}

// Configuration des événements Socket.IO pour le jeu
function setupSocketGameEvents() {
  if (!socket) return

  socket.on(
    "roomCreated",
    ({ roomId: newRoomId, gameState: newState, mode: newMode, playerSymbol: newSymbol, roomName }) => {
      roomId = newRoomId
      gameState = newState
      mode = newMode
      playerSymbol = newSymbol
      waitingForOpponent = true
      onlineGameActive = false

      updateOnlineGameInfo()

      const currentPlayerEl = document.getElementById("current-player")
      if (currentPlayerEl) {
        currentPlayerEl.textContent = `Vous êtes ${playerSymbol}. En attente d'un adversaire...`
        currentPlayerEl.className = "game-status waiting"
      }

      showNotification(`Salle créée: ${roomId}. Partagez cet ID pour inviter un adversaire.`, "success")
      playSound("notification")
    },
  )

  socket.on("gameStart", ({ roomId: newRoomId, gameState: newState, playerSymbol: newSymbol, opponent }) => {
    roomId = newRoomId
    gameState = newState
    playerSymbol = newSymbol
    waitingForOpponent = false
    onlineGameActive = true

    updateOnlineGameInfo(opponent)
    updateBoardFromGameState()

    const currentPlayerEl = document.getElementById("current-player")
    if (currentPlayerEl) {
      const isYourTurn = gameState.currentPlayer === playerSymbol
      currentPlayerEl.textContent = isYourTurn ? "C'est votre tour" : "Tour de l'adversaire"
      currentPlayerEl.className = isYourTurn ? "game-status your-turn" : "game-status opponent-turn"
    }

    // Ne pas démarrer le timer
    // startTurnTimer(30)

    showNotification(
      "Partie commencée! " +
        (gameState.currentPlayer === playerSymbol ? "C'est votre tour." : "En attente de votre adversaire."),
      "success",
    )
    playSound("notification")
  })

  socket.on("gameUpdate", ({ gameState: newState, move, playerId, winner, pattern, isDraw }) => {
    // Arrêter le timer si actif
    stopTurnTimer()

    gameState = newState

    // Supprimer l'état "en attente" des cellules
    document.querySelectorAll(".move-pending").forEach((cell) => {
      cell.classList.remove("move-pending")
    })

    updateBoardFromGameState()

    const cell = document.querySelector(`[data-index="${move}"]`)
    if (cell) {
      cell.classList.add("animated-placement")
      playSound("move")
    }

    const currentPlayerEl = document.getElementById("current-player")
    if (currentPlayerEl && !winner && !isDraw) {
      const isYourTurn = gameState.currentPlayer === playerSymbol
      currentPlayerEl.textContent = isYourTurn ? "C'est votre tour" : "Tour de l'adversaire"
      currentPlayerEl.className = isYourTurn ? "game-status your-turn" : "game-status opponent-turn"

      // Ne pas redémarrer le timer
      // startTurnTimer(30)
    }

    if (winner) {
      if (pattern) highlightWinningCells(pattern)
      gameState.gameOver = true

      const gameResultEl = document.getElementById("game-result")
      if (gameResultEl) {
        if (winner === playerSymbol) {
          showNotification("Vous avez gagné!", "success")
          gameResultEl.textContent = "Vous avez gagné!"
          gameResultEl.className = "game-result win"
          stats.wins++
          playSound("win")
          showConfetti()
        } else {
          showNotification("Votre adversaire a gagné.", "error")
          gameResultEl.textContent = "Votre adversaire a gagné."
          gameResultEl.className = "game-result lose"
          stats.losses++
          playSound("lose")
          playSound("lose")
        }
        updateStats()
        updateServerStats()

        // Ajouter à l'historique
        addGameToHistory(currentGame, winner === playerSymbol ? "win" : "lose")

        // Vérifier les succès
        checkAchievements()
      }

      // Afficher le bouton de revanche
      showRematchButton()
    } else if (isDraw) {
      gameState.gameOver = true

      const gameResultEl = document.getElementById("game-result")
      if (gameResultEl) {
        showNotification("Match nul!", "warning")
        gameResultEl.textContent = "Match nul!"
        gameResultEl.className = "game-result draw"
        playSound("draw")
      }

      // Ajouter à l'historique
      addGameToHistory(currentGame, "draw")

      // Afficher le bouton de revanche
      showRematchButton()
    }

    isProcessing = false
  })

  socket.on("gameReset", ({ gameState: newState }) => {
    gameState = newState
    updateBoardFromGameState()

    // Supprimer les boutons de revanche
    const rematchButtons = document.querySelectorAll(".rematch-btn, .accept-rematch-btn")
    rematchButtons.forEach((btn) => btn.remove())

    const currentPlayerEl = document.getElementById("current-player")
    if (currentPlayerEl) {
      const isYourTurn = gameState.currentPlayer === playerSymbol
      currentPlayerEl.textContent = isYourTurn ? "C'est votre tour" : "Tour de l'adversaire"
      currentPlayerEl.className = isYourTurn ? "game-status your-turn" : "game-status opponent-turn"
    }

    const gameResultEl = document.getElementById("game-result")
    if (gameResultEl) {
      gameResultEl.textContent = ""
      gameResultEl.className = "game-result"
    }

    // Ne pas redémarrer le timer
    // startTurnTimer(30)

    showNotification("Partie réinitialisée!", "success")
    playSound("notification")
    isProcessing = false
  })

  socket.on("playerLeft", ({ message }) => {
    showNotification(message, "error")

    const gameResultEl = document.getElementById("game-result")
    if (gameResultEl) {
      gameResultEl.textContent = "Adversaire déconnecté."
      gameResultEl.className = "game-result disconnect"
    }

    waitingForOpponent = true
    onlineGameActive = false

    // Arrêter le timer
    stopTurnTimer()

    updateOnlineGameInfo()

    const currentPlayerEl = document.getElementById("current-player")
    if (currentPlayerEl) {
      currentPlayerEl.textContent = "En attente d'un adversaire..."
      currentPlayerEl.className = "game-status waiting"
    }

    playSound("notification")
  })

  socket.on("joinError", ({ message }) => {
    showNotification(message, "error")
    document.getElementById("join-room-interface").style.display = "block"
    document.getElementById("game-container").style.display = "none"
    playSound("notification")
  })

  socket.on("error", (message) => {
    showNotification(typeof message === "string" ? message : message.message || "Erreur inconnue", "error")
    isProcessing = false
    playSound("notification")
  })

  socket.on("rematchRequested", ({ from }) => {
    showNotification(`${from} vous propose une revanche!`, "info")

    // Créer un bouton pour accepter la revanche
    const gameControls = document.getElementById("game-controls")
    if (gameControls && !document.querySelector(".accept-rematch-btn")) {
      const acceptBtn = document.createElement("button")
      acceptBtn.className = "btn-primary accept-rematch-btn"
      acceptBtn.textContent = "Accepter la revanche"
      acceptBtn.addEventListener("click", () => {
        socket.emit("acceptRematch", { roomId })
        acceptBtn.disabled = true
        acceptBtn.textContent = "Acceptation en cours..."
        showNotification("Revanche acceptée", "success")
      })

      gameControls.appendChild(acceptBtn)
    }

    playSound("notification")
  })

  socket.on("rematchAccepted", () => {
    showNotification("Revanche acceptée! La partie va recommencer.", "success")

    // Supprimer les boutons de revanche
    const rematchButtons = document.querySelectorAll(".rematch-btn, .accept-rematch-btn")
    rematchButtons.forEach((btn) => btn.remove())

    playSound("notification")
  })

  socket.on("spectatorJoined", ({ username, count }) => {
    showNotification(`${username} regarde votre partie. (${count} spectateurs)`, "info")
    updateSpectatorCount(count)
  })

  socket.on("spectatorLeft", ({ username, count }) => {
    showNotification(`${username} a quitté votre partie. (${count} spectateurs)`, "info")
    updateSpectatorCount(count)
  })

  socket.on("turnTimerUpdate", ({ seconds }) => {
    updateTurnTimer(seconds)
  })

  socket.on("turnTimedOut", ({ player }) => {
    if (player === playerSymbol) {
      showNotification("Temps écoulé! Vous avez perdu votre tour.", "error")
    } else {
      showNotification("Votre adversaire a mis trop de temps. C'est votre tour.", "success")
    }
    playSound("notification")
  })

  socket.on("achievementUnlocked", ({ achievement }) => {
    showNotification(`Succès débloqué: ${achievement.name}!`, "success")
    playSound("win")

    // Ajouter l'achievement à la liste
    if (!achievements.find((a) => a.id === achievement.id)) {
      achievements.push(achievement)
      updateAchievements()
    }
  })
}

// Mettre à jour le compteur de spectateurs
function updateSpectatorCount(count) {
  const onlineInfo = document.getElementById("online-game-info")
  if (!onlineInfo) return

  let spectatorBadge = onlineInfo.querySelector(".spectator-count")

  if (!spectatorBadge && count > 0) {
    spectatorBadge = document.createElement("div")
    spectatorBadge.className = "spectator-count"
    onlineInfo.appendChild(spectatorBadge)
  }

  if (spectatorBadge) {
    if (count > 0) {
      spectatorBadge.textContent = `👁️ ${count} spectateur${count > 1 ? "s" : ""}`
      spectatorBadge.style.display = "block"
    } else {
      spectatorBadge.style.display = "none"
    }
  }
}

// Afficher le bouton de revanche
function showRematchButton() {
  const gameControls = document.getElementById("game-controls")
  if (!gameControls || document.querySelector(".rematch-btn")) return

  const rematchBtn = document.createElement("button")
  rematchBtn.className = "btn-primary rematch-btn"
  rematchBtn.textContent = "Demander une revanche"
  rematchBtn.addEventListener("click", () => {
    socket.emit("requestRematch", { roomId })
    rematchBtn.disabled = true
    rematchBtn.textContent = "Demande envoyée..."
    showNotification("Demande de revanche envoyée", "success")
  })

  gameControls.appendChild(rematchBtn)
}

// Initialisation après chargement du DOM
document.addEventListener("DOMContentLoaded", async () => {
  console.log("DOM chargé, initialisation en cours...")

  // Appliquer le thème
  applyTheme(currentTheme)

  // Initialiser les tutoriels
  initializeTutorials()

  // Vérifions d'abord la disponibilité du serveur
  const serverAvailable = await checkServer()

  if (serverAvailable) {
    // Initialisons Socket.IO seulement si le serveur est disponible
    initializeSocketIO()
  }

  initializeAuth()
  initializeWelcomeScreen()
  initializeGameHub()
  initializeModals()
  updateStats()

  // Vérifier si un utilisateur est déjà connecté
  if (token) {
    console.log("Token trouvé dans localStorage, récupération des données utilisateur...")
    fetchUserData()
  }

  // Jouer la musique de fond si activée
  if (musicEnabled) {
    playSound("bgMusic")
  }
})

// Initialiser l'écran d'accueil
function initializeWelcomeScreen() {
  const startAuthBtn = document.getElementById("start-auth")
  const playAsGuestBtn = document.getElementById("play-as-guest")

  if (startAuthBtn) {
    startAuthBtn.addEventListener("click", () => {
      document.getElementById("welcome-screen").style.display = "none"
      document.getElementById("auth-section").style.display = "block"
      playSound("click")
    })
  }

  if (playAsGuestBtn) {
    playAsGuestBtn.addEventListener("click", () => {
      document.getElementById("welcome-screen").style.display = "none"
      document.getElementById("game-hub").style.display = "block"
      playSound("click")
    })
  }

  // Bouton de retour à l'accueil
  const backToWelcomeBtn = document.getElementById("back-to-welcome")
  if (backToWelcomeBtn) {
    backToWelcomeBtn.addEventListener("click", () => {
      document.getElementById("auth-section").style.display = "none"
      document.getElementById("welcome-screen").style.display = "block"
      playSound("click")
    })
  }
}

// Initialiser le hub de jeu
function initializeGameHub() {
  // Bouton de changement de thème
  const themeToggleBtn = document.getElementById("theme-toggle")
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener("click", () => {
      toggleTheme()
      playSound("click")
    })
  }

  // Bouton de paramètres
  const settingsBtn = document.getElementById("settings-btn")
  if (settingsBtn) {
    settingsBtn.addEventListener("click", () => {
      openModal("settings-modal")
      playSound("click")
    })
  }

  // Initialiser l'interface de salle en ligne
  initializeRoomInterface()
}

// Initialiser l'interface de salle en ligne
function initializeRoomInterface() {
  const joinRoomBtn = document.getElementById("join-room-btn")
  const createRoomBtn = document.getElementById("create-room-btn")
  const quickMatchBtn = document.getElementById("quick-match-btn")
  const backToModeBtn = document.getElementById("back-to-mode-btn")

  if (joinRoomBtn) {
    joinRoomBtn.addEventListener("click", () => {
      const roomIdInput = document.getElementById("room-id-input").value.trim()
      if (roomIdInput) {
        joinRoomFunc(roomIdInput)
        playSound("click")
      } else {
        showNotification("Veuillez entrer un ID de salle valide", "error")
      }
    })
  }

  if (createRoomBtn) {
    createRoomBtn.addEventListener("click", () => {
      createRoomFunc()
      playSound("click")
    })
  }

  if (quickMatchBtn) {
    quickMatchBtn.addEventListener("click", () => {
      findQuickMatch()
      playSound("click")
    })
  }

  if (backToModeBtn) {
    backToModeBtn.addEventListener("click", () => {
      document.getElementById("join-room-interface").style.display = "none"
      document.getElementById("mode-selection").style.display = "block"
      playSound("click")
    })
  }
}

// Trouver une partie rapide
function findQuickMatch() {
  if (!socketConnected) {
    showNotification("Impossible de trouver une partie. Vérifiez votre connexion au serveur.", "error")
    return
  }

  showNotification("Recherche d'une partie en cours...", "info")
  socket.emit("findQuickMatch", { gameType: currentGame })

  // Afficher un indicateur de recherche
  const joinRoomInterface = document.getElementById("join-room-interface")
  if (joinRoomInterface) {
    joinRoomInterface.innerHTML = `
      <h3>Recherche d'une partie</h3>
      <div class="matchmaking-indicator">
        <div class="spinner"></div>
        <p>Recherche d'adversaires en cours...</p>
        <button class="btn-secondary" id="cancel-matchmaking">Annuler</button>
      </div>
    `

    document.getElementById("cancel-matchmaking").addEventListener("click", () => {
      socket.emit("cancelMatchmaking")
      document.getElementById("join-room-interface").style.display = "none"
      document.getElementById("mode-selection").style.display = "block"
      playSound("click")
    })
  }
}

// Initialiser les modales
function initializeModals() {
  // Boutons de fermeture
  const closeButtons = document.querySelectorAll(".close-modal")
  closeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const modal = btn.closest(".modal")
      if (modal) {
        closeModal(modal.id)
      }
      playSound("click")
    })
  })

  // Paramètres
  const saveSettingsBtn = document.getElementById("save-settings")
  const resetSettingsBtn = document.getElementById("reset-settings")
  const soundEffectsToggle = document.getElementById("sound-effects")
  const backgroundMusicToggle = document.getElementById("background-music")
  const volumeControl = document.getElementById("volume-control")
  const themeSelect = document.getElementById("theme-select")

  if (saveSettingsBtn) {
    saveSettingsBtn.addEventListener("click", () => {
      // Sauvegarder les paramètres
      if (soundEffectsToggle) {
        soundEnabled = soundEffectsToggle.checked
        localStorage.setItem("soundEnabled", soundEnabled)
      }

      if (backgroundMusicToggle) {
        musicEnabled = backgroundMusicToggle.checked
        localStorage.setItem("musicEnabled", musicEnabled)

        if (musicEnabled) {
          playSound("bgMusic")
        } else {
          sounds.bgMusic.pause()
        }
      }

      if (volumeControl) {
        volume = volumeControl.value
        updateVolume()
      }

      if (themeSelect) {
        applyTheme(themeSelect.value)
      }

      closeModal("settings-modal")
      showNotification("Paramètres sauvegardés", "success")
      playSound("click")
    })
  }

  if (resetSettingsBtn) {
    resetSettingsBtn.addEventListener("click", () => {
      // Réinitialiser les paramètres
      if (soundEffectsToggle) soundEffectsToggle.checked = true
      if (backgroundMusicToggle) backgroundMusicToggle.checked = false
      if (volumeControl) volumeControl.value = 50
      if (themeSelect) themeSelect.value = "dark"

      playSound("click")
    })
  }

  // Initialiser les valeurs des paramètres
  if (soundEffectsToggle) soundEffectsToggle.checked = soundEnabled
  if (backgroundMusicToggle) backgroundMusicToggle.checked = musicEnabled
  if (volumeControl) volumeControl.value = volume
  if (themeSelect) themeSelect.value = currentTheme

  // Aide de jeu
  const gameHelpBtn = document.getElementById("game-help")
  if (gameHelpBtn) {
    gameHelpBtn.addEventListener("click", () => {
      showTutorial(currentGame)
      playSound("click")
    })
  }
}

// Ouvrir une modale
function openModal(modalId) {
  const modal = document.getElementById(modalId)
  if (modal) {
    modal.style.display = "flex"
    modal.classList.add("show")

    // Si c'est la modale de profil, mettre à jour les données
    if (modalId === "profile-modal") {
      updateProfileModal()
    }
  }
}

// Fermer une modale
function closeModal(modalId) {
  const modal = document.getElementById(modalId)
  if (modal) {
    modal.classList.remove("show")
    setTimeout(() => {
      modal.style.display = "none"
    }, 300)
  }
}

// Mettre à jour la modale de profil
function updateProfileModal() {
  if (!user) return

  document.getElementById("profile-username").textContent = user.username
  document.getElementById("profile-level").textContent = calculateLevel()
  document.getElementById("profile-wins").textContent = stats.wins
  document.getElementById("profile-losses").textContent = stats.losses

  const ratio = stats.wins + stats.losses > 0 ? Math.round((stats.wins / (stats.wins + stats.losses)) * 100) : 0
  document.getElementById("profile-ratio").textContent = `${ratio}%`

  // Mettre à jour les succès
  updateAchievements()

  // Mettre à jour l'historique
  updateGameHistory()
}

// Calculer le niveau
function calculateLevel() {
  const totalGames = stats.wins + stats.losses
  const baseLevel = Math.floor(totalGames / 10) + 1
  const winBonus = Math.floor(stats.wins / 5)
  return Math.min(50, baseLevel + winBonus)
}

// Mettre à jour les succès
function updateAchievements() {
  const achievementsList = document.getElementById("achievements-list")
  if (!achievementsList) return

  if (achievements.length === 0) {
    achievementsList.innerHTML = `
      <div class="achievement locked">
        <div class="achievement-icon">🏆</div>
        <div class="achievement-info">
          <div class="achievement-name">Première Victoire</div>
          <div class="achievement-desc">Gagnez votre première partie</div>
        </div>
      </div>
      <div class="achievement locked">
        <div class="achievement-icon">🔥</div>
        <div class="achievement-info">
          <div class="achievement-name">Sur une lancée</div>
          <div class="achievement-desc">Gagnez 3 parties d'affilée</div>
        </div>
      </div>
      <div class="achievement locked">
        <div class="achievement-icon">🌟</div>
        <div class="achievement-info">
          <div class="achievement-name">Maître du jeu</div>
          <div class="achievement-desc">Atteignez le niveau 10</div>
        </div>
      </div>
    `
  } else {
    achievementsList.innerHTML = achievements
      .map(
        (achievement) => `
      <div class="achievement">
        <div class="achievement-icon">${achievement.icon}</div>
        <div class="achievement-info">
          <div class="achievement-name">${achievement.name}</div>
          <div class="achievement-desc">${achievement.description}</div>
        </div>
      </div>
    `,
      )
      .join("")
  }
}

// Vérifier les succès
function checkAchievements() {
  // Cette fonction serait normalement appelée côté serveur
  // Mais pour l'exemple, nous la simulons ici

  const totalGames = stats.wins + stats.losses
  const level = calculateLevel()

  // Première victoire
  if (stats.wins >= 1 && !achievements.find((a) => a.id === "first_win")) {
    const achievement = {
      id: "first_win",
      name: "Première Victoire",
      description: "Gagnez votre première partie",
      icon: "🏆",
    }

    achievements.push(achievement)
    showNotification(`Succès débloqué: ${achievement.name}!`, "success")
    playSound("win")
  }

  // Niveau 10
  if (level >= 10 && !achievements.find((a) => a.id === "master")) {
    const achievement = {
      id: "master",
      name: "Maître du jeu",
      description: "Atteignez le niveau 10",
      icon: "🌟",
    }

    achievements.push(achievement)
    showNotification(`Succès débloqué: ${achievement.name}!`, "success")
    playSound("win")
  }

  // Mettre à jour l'affichage des succès
  updateAchievements()
}

// Ajouter une partie à l'historique
function addGameToHistory(gameType, result) {
  const gameNames = {
    "tic-tac-toe": "Tic-Tac-Toe",
    "connect-four": "Connect Four",
    checkers: "Checkers",
  }

  const resultNames = {
    win: "Victoire",
    lose: "Défaite",
    draw: "Match nul",
  }

  const historyEntry = {
    gameType: gameNames[gameType] || gameType,
    result: resultNames[result] || result,
    opponent:
      mode === "online"
        ? document.getElementById("opponent-name")?.textContent || "Adversaire"
        : mode === "solo"
          ? "IA"
          : "Joueur local",
    timestamp: new Date().toISOString(),
  }

  gameHistory.unshift(historyEntry)

  // Limiter l'historique à 10 parties
  if (gameHistory.length > 10) {
    gameHistory = gameHistory.slice(0, 10)
  }

  // Mettre à jour l'affichage de l'historique
  updateGameHistory()
}

// Mettre à jour l'historique des parties
function updateGameHistory() {
  const historyList = document.getElementById("game-history")
  if (!historyList) return

  if (gameHistory.length === 0) {
    historyList.innerHTML = `<div class="no-history">Aucune partie jouée récemment</div>`
    return
  }

  historyList.innerHTML = gameHistory
    .map((entry) => {
      const date = new Date(entry.timestamp)
      const formattedDate = `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`

      let resultClass = ""
      if (entry.result === "Victoire") resultClass = "text-success"
      else if (entry.result === "Défaite") resultClass = "text-error"

      return `
      <div class="history-entry">
        <div class="history-game">${entry.gameType}</div>
        <div class="history-result ${resultClass}">${entry.result}</div>
        <div class="history-opponent">vs ${entry.opponent}</div>
        <div class="history-date">${formattedDate}</div>
      </div>
    `
    })
    .join("")
}

// Appliquer un thème
function applyTheme(theme) {
  if (theme === "light") {
    document.body.classList.add("light-mode")
  } else {
    document.body.classList.remove("light-mode")
  }

  currentTheme = theme
  localStorage.setItem("theme", theme)
}

// Basculer le thème
function toggleTheme() {
  const newTheme = currentTheme === "dark" ? "light" : "dark"
  applyTheme(newTheme)
}

// Initialiser les tutoriels
function initializeTutorials() {
  tutorialSteps = {
    "tic-tac-toe": [
      {
        title: "Tic-Tac-Toe - Règles du jeu",
        content: `
          <p>Le Tic-Tac-Toe est un jeu simple où deux joueurs s'affrontent sur une grille de 3x3.</p>
          <p>Le but est d'aligner 3 symboles identiques horizontalement, verticalement ou en diagonale.</p>
          <img src="images/ttt-rules.png" alt="Exemple de grille" style="max-width: 200px; margin: 1rem auto; display: block;">
        `,
      },
      {
        title: "Comment jouer",
        content: `
          <p>À tour de rôle, chaque joueur place son symbole (X ou O) dans une case vide.</p>
          <p>Le premier joueur utilise X, le second utilise O.</p>
          <p>Cliquez simplement sur une case vide pour y placer votre symbole.</p>
        `,
      },
      {
        title: "Modes de jeu",
        content: `
          <p><strong>Solo:</strong> Jouez contre l'IA avec différents niveaux de difficulté.</p>
          <p><strong>Local:</strong> Jouez à deux sur le même appareil.</p>
          <p><strong>En ligne:</strong> Affrontez d'autres joueurs en temps réel.</p>
        `,
      },
      {
        title: "Astuces",
        content: `
          <p>Le centre de la grille est souvent une position stratégique.</p>
          <p>Essayez de bloquer votre adversaire s'il a déjà aligné deux symboles.</p>
          <p>Créez des "fourches" en ayant deux possibilités d'alignement en même temps.</p>
        `,
      },
    ],
    "connect-four": [
      {
        title: "Connect Four - Règles du jeu",
        content: `
          <p>Connect Four est un jeu où deux joueurs font tomber des jetons dans une grille de 7x6.</p>
          <p>Le but est d'aligner 4 jetons de sa couleur horizontalement, verticalement ou en diagonale.</p>
        `,
      },
      {
        title: "Comment jouer",
        content: `
          <p>À tour de rôle, chaque joueur place un jeton dans une colonne.</p>
          <p>Le jeton tombe jusqu'à la position la plus basse disponible.</p>
          <p>Cliquez sur une colonne pour y placer votre jeton.</p>
        `,
      },
      {
        title: "Modes de jeu",
        content: `
          <p><strong>Solo:</strong> Jouez contre l'IA avec différents niveaux de difficulté.</p>
          <p><strong>Local:</strong> Jouez à deux sur le même appareil.</p>
          <p><strong>En ligne:</strong> Affrontez d'autres joueurs en temps réel.</p>
        `,
      },
      {
        title: "Astuces",
        content: `
          <p>Essayez de contrôler le centre de la grille.</p>
          <p>Faites attention aux alignements diagonaux, ils sont souvent moins visibles.</p>
          <p>Parfois, il est préférable de bloquer votre adversaire plutôt que de poursuivre votre propre stratégie.</p>
        `,
      },
    ],
    checkers: [
      {
        title: "Checkers - Règles du jeu",
        content: `
          <p>Le jeu de dames se joue sur un plateau de 8x8 cases alternées claires et sombres.</p>
          <p>Chaque joueur commence avec 12 pions placés sur les cases sombres des trois premières rangées.</p>
          <p>Le but est de capturer tous les pions adverses ou de bloquer l'adversaire pour qu'il ne puisse plus jouer.</p>
        `,
      },
      {
        title: "Déplacements",
        content: `
          <p>Les pions se déplacent en diagonale d'une case, uniquement vers l'avant (vers le camp adverse).</p>
          <p>Les pions ne peuvent se déplacer que sur des cases vides.</p>
          <p>Lorsqu'un pion atteint la dernière rangée du plateau (côté adverse), il est promu en "dame".</p>
          <p>Les dames peuvent se déplacer en diagonale dans toutes les directions, d'autant de cases qu'elles le souhaitent.</p>
        `,
      },
      {
        title: "Captures",
        content: `
          <p>Pour capturer un pion adverse, votre pion doit sauter par-dessus en diagonale et atterrir sur une case vide juste après.</p>
          <p>Les captures sont obligatoires. Si vous pouvez capturer, vous devez le faire.</p>
          <p>Si après une capture, votre pion peut en capturer un autre, vous devez continuer la séquence de captures.</p>
          <p>Les dames peuvent capturer à distance, en sautant par-dessus un pion adverse et en atterrissant sur n'importe quelle case vide de la même diagonale.</p>
        `,
      },
      {
        title: "Fin de partie",
        content: `
          <p>La partie est gagnée lorsque tous les pions adverses sont capturés.</p>
          <p>La partie est également gagnée si l'adversaire ne peut plus bouger (bloqué).</p>
          <p>La partie est déclarée nulle après 50 coups sans capture ni avancement de pion.</p>
        `,
      },
    ],
  }
}

// Afficher un tutoriel
function showTutorial(gameType) {
  if (!tutorialSteps[gameType]) {
    showNotification("Tutoriel non disponible pour ce jeu", "error")
    return
  }

  const steps = tutorialSteps[gameType]
  currentTutorialStep = 0

  const tutorialModal = document.getElementById("tutorial-modal")
  const tutorialTitle = document.getElementById("tutorial-title")
  const tutorialContent = document.getElementById("tutorial-content")
  const prevStepBtn = document.getElementById("prev-step")
  const nextStepBtn = document.getElementById("next-step")
  const tutorialProgress = document.getElementById("tutorial-progress")

  if (!tutorialModal || !tutorialTitle || !tutorialContent || !prevStepBtn || !nextStepBtn || !tutorialProgress) {
    console.error("Éléments du tutoriel manquants")
    return
  }

  // Créer les points de progression
  tutorialProgress.innerHTML = `
    <div class="progress-dots">
      ${steps
        .map(
          (_, index) => `
        <div class="progress-dot ${index === 0 ? "active" : ""}"></div>
      `,
        )
        .join("")}
    </div>
  `

  // Afficher la première étape
  tutorialTitle.textContent = steps[0].title
  tutorialContent.innerHTML = steps[0].content
  prevStepBtn.disabled = true
  nextStepBtn.textContent = steps.length > 1 ? "Suivant" : "Terminer"

  // Ouvrir la modale
  openModal("tutorial-modal")

  // Gérer la navigation
  prevStepBtn.onclick = () => {
    if (currentTutorialStep > 0) {
      currentTutorialStep--
      updateTutorialStep()
      playSound("click")
    }
  }

  nextStepBtn.onclick = () => {
    if (currentTutorialStep < steps.length - 1) {
      currentTutorialStep++
      updateTutorialStep()
      playSound("click")
    } else {
      closeModal("tutorial-modal")
      playSound("click")
    }
  }

  // Fonction pour mettre à jour l'étape du tutoriel
  function updateTutorialStep() {
    tutorialTitle.textContent = steps[currentTutorialStep].title
    tutorialContent.innerHTML = steps[currentTutorialStep].content

    prevStepBtn.disabled = currentTutorialStep === 0
    nextStepBtn.textContent = currentTutorialStep < steps.length - 1 ? "Suivant" : "Terminer"

    // Mettre à jour les points de progression
    const dots = tutorialProgress.querySelectorAll(".progress-dot")
    dots.forEach((dot, index) => {
      dot.classList.toggle("active", index === currentTutorialStep)
    })
  }
}

// Initialiser les formulaires d'authentification
function initializeAuth() {
  console.log("Initialisation des formulaires d'authentification...")
  const loginForm = document.getElementById("login")
  const signupForm = document.getElementById("signup")
  const showSignupLink = document.getElementById("show-signup")
  const showLoginLink = document.getElementById("show-login")
  const logoutBtn = document.getElementById("logout-btn")
  const showPasswordCheckbox = document.getElementById("show-password")
  const passwordInput = document.getElementById("login-password")
  const signupPasswordInput = document.getElementById("signup-password")
  const confirmPasswordInput = document.getElementById("signup-confirm-password")
  const avatarOptions = document.querySelectorAll(".avatar-option")
  const avatarInput = document.getElementById("signup-avatar")

  if (!loginForm || !signupForm || !showSignupLink || !showLoginLink || !logoutBtn) {
    console.error("Erreur: un ou plusieurs éléments d'authentification introuvables", {
      loginForm: !!loginForm,
      signupForm: !!signupForm,
      showSignupLink: !!showSignupLink,
      logoutBtn: !!logoutBtn,
    })
    showNotification("Erreur: interface d'authentification incomplète", "error")
    return
  }

  // Afficher/masquer le mot de passe
  if (showPasswordCheckbox && passwordInput) {
    showPasswordCheckbox.addEventListener("change", () => {
      passwordInput.type = showPasswordCheckbox.checked ? "text" : "password"
    })
  }

  // Sélection d'avatar
  if (avatarOptions && avatarInput) {
    avatarOptions.forEach((option) => {
      option.addEventListener("click", () => {
        avatarOptions.forEach((opt) => opt.classList.remove("selected"))
        option.classList.add("selected")
        avatarInput.value = option.dataset.avatar
        playSound("click")
      })
    })
  }

  // Vérification de la force du mot de passe
  if (signupPasswordInput) {
    signupPasswordInput.addEventListener("input", () => {
      const password = signupPasswordInput.value
      const strengthBar = document.querySelector(".strength-bar")
      const strengthText = document.querySelector(".strength-text")

      if (!strengthBar || !strengthText) return

      let strength = 0
      let feedback = "Très faible"

      // Longueur
      if (password.length >= 8) strength += 25

      // Lettres majuscules et minuscules
      if (password.match(/[a-z]/) && password.match(/[A-Z]/)) strength += 25

      // Chiffres
      if (password.match(/\d/)) strength += 25

      // Caractères spéciaux
      if (password.match(/[^a-zA-Z\d]/)) strength += 25

      // Définir la couleur et le texte
      let color
      if (strength <= 25) {
        color = "#ef4444"
        feedback = "Très faible"
      } else if (strength <= 50) {
        color = "#f59e0b"
        feedback = "Faible"
      } else if (strength <= 75) {
        color = "#10b981"
        feedback = "Moyen"
      } else {
        color = "#22c55e"
        feedback = "Fort"
      }

      strengthBar.style.width = `${strength}%`
      strengthBar.style.backgroundColor = color
      strengthText.textContent = `Force du mot de passe: ${feedback}`
    })
  }

  // Vérification de la correspondance des mots de passe
  if (confirmPasswordInput && signupPasswordInput) {
    confirmPasswordInput.addEventListener("input", () => {
      if (confirmPasswordInput.value && confirmPasswordInput.value !== signupPasswordInput.value) {
        confirmPasswordInput.setCustomValidity("Les mots de passe ne correspondent pas")
      } else {
        confirmPasswordInput.setCustomValidity("")
      }
    })

    signupPasswordInput.addEventListener("input", () => {
      if (confirmPasswordInput.value && confirmPasswordInput.value !== signupPasswordInput.value) {
        confirmPasswordInput.setCustomValidity("Les mots de passe ne correspondent pas")
      } else {
        confirmPasswordInput.setCustomValidity("")
      }
    })
  }

  // Mettons à jour la fonction de connexion pour gérer correctement la réponse
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault()
    const username = document.getElementById("login-username").value.trim()
    const password = document.getElementById("login-password").value.trim()

    if (!username || !password) {
      showNotification("Veuillez remplir tous les champs", "error")
      return
    }

    try {
      console.log(`Envoi de la requête de connexion à ${BASE_URL}/api/auth/login`, { username })

      // Désactivons le bouton pendant la requête
      const submitButton = loginForm.querySelector('button[type="submit"]')
      if (submitButton) {
        submitButton.disabled = true
        submitButton.textContent = "Connexion en cours..."
      }

      const response = await fetch(`${BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
        credentials: "same-origin",
      })

      // Réactivons le bouton
      if (submitButton) {
        submitButton.disabled = false
        submitButton.textContent = "Se connecter"
      }

      // Vérifions d'abord si la réponse est OK
      if (!response.ok) {
        let errorMessage = "Erreur serveur"

        try {
          const errorData = await response.clone().json()
          errorMessage = errorData.message || errorMessage
        } catch (parseError) {
          console.error("Erreur de parsing de la réponse d'erreur:", parseError)
          const text = await response.text()
          console.error("Réponse brute:", text)
          errorMessage = "Erreur serveur: Réponse inattendue"
        }

        showNotification(errorMessage, "error")
        return
      }

      // Essayons de parser la réponse JSON
      let data
      try {
        data = await response.json()
      } catch (parseError) {
        console.error("Erreur de parsing de la réponse:", parseError)
        showNotification("Erreur serveur: Réponse inattendue", "error")
        return
      }

      console.log("Réponse de connexion:", data)

      // Vérifions que la réponse contient les données attendues
      if (!data.token) {
        console.error("Token manquant dans la réponse")
        showNotification("Erreur: Réponse serveur invalide (token manquant)", "error")
        return
      }

      if (!data.user) {
        console.error("Données utilisateur manquantes dans la réponse")
        showNotification("Erreur: Réponse serveur invalide (user manquant)", "error")
        return
      }

      // Stockons le token et les données utilisateur
      localStorage.setItem("jwt_token", data.token)
      token = data.token
      user = data.user

      console.log("Utilisateur connecté:", user)
      showNotification(data.message || "Connexion réussie", "success")
      playSound("notification")

      // Mettons à jour l'authentification du socket
      if (socket) {
        socket.auth = { token }
        socket.disconnect().connect()
      }

      // Récupérons les statistiques utilisateur
      await fetchUserData()

      // Mettons à jour l'interface
      updateAuthUI()
    } catch (error) {
      console.error("Erreur de connexion:", error)
      showNotification(`Erreur: ${error.message}`, "error")
    }
  })

  signupForm.addEventListener("submit", async (e) => {
    e.preventDefault()
    const username = document.getElementById("signup-username").value.trim()
    const email = document.getElementById("signup-email").value.trim()
    const password = document.getElementById("signup-password").value.trim()
    const confirmPassword = document.getElementById("signup-confirm-password").value.trim()
    const avatar = document.getElementById("signup-avatar").value

    if (!username || !email || !password || !confirmPassword) {
      showNotification("Veuillez remplir tous les champs", "error")
      return
    }

    if (password !== confirmPassword) {
      showNotification("Les mots de passe ne correspondent pas", "error")
      return
    }

    try {
      console.log(`Envoi de la requête d'inscription à ${BASE_URL}/api/auth/register`)

      // Désactivons le bouton pendant la requête
      const submitButton = signupForm.querySelector('button[type="submit"]')
      if (submitButton) {
        submitButton.disabled = true
        submitButton.textContent = "Inscription en cours..."
      }

      const response = await fetch(`${BASE_URL}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, email, password, avatar }),
      })

      // Réactivons le bouton
      if (submitButton) {
        submitButton.disabled = false
        submitButton.textContent = "S'inscrire"
      }

      if (!response.ok) {
        const contentType = response.headers.get("content-type")
        if (contentType && contentType.includes("application/json")) {
          const errorData = await response.json()
          showNotification(errorData.message || "Erreur serveur", "error")
        } else {
          const text = await response.text()
          console.error("Réponse non-JSON reçue:", text)
          // Ne pas afficher de notification pour ce type d'erreur
        }
        return
      }

      const data = await response.json()
      console.log("Réponse d'inscription:", data)
      showNotification(data.message || "Inscription réussie", "success")
      playSound("notification")

      // Pré-remplir le formulaire de connexion
      document.getElementById("login-username").value = username

      // Basculer vers le formulaire de connexion
      document.getElementById("signup-form").style.display = "none"
      document.getElementById("login-form").style.display = "block"
    } catch (error) {
      console.error("Erreur d'inscription:", error)
      showNotification(`Erreur: ${error.message}`, "error")
    }
  })

  showSignupLink.addEventListener("click", (e) => {
    e.preventDefault()
    console.log("Affichage du formulaire d'inscription")
    document.getElementById("login-form").style.display = "none"
    document.getElementById("signup-form").style.display = "block"
    playSound("click")
  })

  showLoginLink.addEventListener("click", (e) => {
    e.preventDefault()
    console.log("Affichage du formulaire de connexion")
    document.getElementById("signup-form").style.display = "none"
    document.getElementById("login-form").style.display = "block"
    playSound("click")
  })

  logoutBtn.addEventListener("click", () => {
    console.log("Déconnexion de l'utilisateur")
    localStorage.removeItem("jwt_token")
    token = null
    user = null
    if (socket) {
      socket.auth = {}
      socket.disconnect().connect()
    }
    updateAuthUI()
    showNotification("Déconnexion réussie", "success")
    playSound("notification")
  })
}

// Mettre à jour l'interface utilisateur en fonction de l'état de l'authentification
function updateAuthUI() {
  console.log("updateAuthUI appelé, user:", user)
  const welcomeScreen = document.getElementById("welcome-screen")
  const authSection = document.getElementById("auth-section")
  const gameHub = document.getElementById("game-hub")
  const usernameSpan = document.getElementById("username")
  const logoutBtn = document.getElementById("logout-btn")
  const userAvatar = document.getElementById("user-avatar")
  const userLevel = document.getElementById("user-level")
  const levelBar = document.getElementById("level-bar")

  if (!welcomeScreen || !authSection || !gameHub || !usernameSpan || !logoutBtn) {
    console.error("Erreur: éléments d'interface introuvables", {
      welcomeScreen: !!welcomeScreen,
      authSection: !!authSection,
      gameHub: !!gameHub,
      usernameSpan: !!usernameSpan,
      logoutBtn: !!logoutBtn,
    })
    showNotification("Erreur: interface incomplète", "error")
    return
  }

  try {
    if (user) {
      console.log("Utilisateur connecté, affichage de #game-hub")
      welcomeScreen.style.display = "none"
      authSection.style.display = "none"
      gameHub.style.display = "block"
      usernameSpan.textContent = user.username
      logoutBtn.style.display = "inline-block"

      // Mettre à jour l'avatar
      if (userAvatar && user.avatar) {
        const avatarEmojis = {
          default: "👤",
          gamer: "🎮",
          ninja: "🥷",
          alien: "👽",
          robot: "🤖",
        }
        userAvatar.textContent = avatarEmojis[user.avatar] || "👤"
      }

      // Mettre à jour le niveau
      if (userLevel && levelBar) {
        const level = calculateLevel()
        userLevel.textContent = level

        // Calculer la progression vers le niveau suivant
        const totalGames = stats.wins + stats.losses
        const gamesForCurrentLevel = (level - 1) * 10
        const gamesForNextLevel = level * 10
        const progress = ((totalGames - gamesForCurrentLevel) / (gamesForNextLevel - gamesForCurrentLevel)) * 100

        levelBar.style.width = `${Math.min(100, progress)}%`
      }
    } else {
      console.log("Aucun utilisateur connecté, affichage de #welcome-screen")
      welcomeScreen.style.display = "block"
      authSection.style.display = "none"
      gameHub.style.display = "none"
      logoutBtn.style.display = "none"
    }
  } catch (error) {
    console.error("Erreur lors de la mise à jour de l'interface:", error)
    showNotification("Erreur lors de la mise à jour de l'interface", "error")
  }
}

// Récupérer les données utilisateur
async function fetchUserData() {
  if (!token) {
    console.log("Aucun token, impossible de récupérer les données utilisateur")
    return
  }

  try {
    console.log(`Récupération des données utilisateur depuis ${BASE_URL}/api/user/profile`)
    const response = await fetch(`${BASE_URL}/api/user/profile`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      if (response.status === 401) {
        console.error("Token invalide ou expiré")
        localStorage.removeItem("jwt_token")
        token = null
        user = null
        updateAuthUI()
        showNotification("Session expirée, veuillez vous reconnecter", "error")
        return
      }

      throw new Error(`Erreur serveur: ${response.status}`)
    }

    const data = await response.json()
    console.log("Données utilisateur récupérées:", data)

    if (!data.user) {
      throw new Error("Données utilisateur manquantes dans la réponse")
    }

    user = data.user

    // Mettre à jour les statistiques
    if (data.stats) {
      stats.wins = data.stats.wins || 0
      stats.losses = data.stats.losses || 0
      updateStats()
    }

    // Mettre à jour les succès
    if (data.achievements) {
      achievements = data.achievements
      updateAchievements()
    }

    // Mettre à jour l'historique
    if (data.gameHistory) {
      gameHistory = data.gameHistory
      updateGameHistory()
    }

    updateAuthUI()
  } catch (error) {
    console.error("Erreur lors de la récupération des données utilisateur:", error)
    showNotification(`Erreur: ${error.message}`, "error")
  }
}

// Mettre à jour les statistiques sur le serveur
async function updateServerStats() {
  if (!token || !user) return

  try {
    const response = await fetch(`${BASE_URL}/api/user/stats`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        wins: stats.wins,
        losses: stats.losses,
      }),
    })

    if (!response.ok) {
      console.error("Erreur lors de la mise à jour des statistiques:", response.status)
    }
  } catch (error) {
    console.error("Erreur lors de la mise à jour des statistiques:", error)
  }
}

// Mettre à jour les statistiques locales
function updateStats() {
  document.getElementById("wins").textContent = stats.wins
  document.getElementById("losses").textContent = stats.losses

  // Mettre à jour les statistiques par jeu
  if (currentGame === "tic-tac-toe") {
    document.getElementById("ttt-games").textContent = stats.wins + stats.losses
    document.getElementById("ttt-wins").textContent = stats.wins
  } else if (currentGame === "connect-four") {
    document.getElementById("c4-games").textContent = stats.wins + stats.losses
    document.getElementById("c4-wins").textContent = stats.wins
  }

  // Sauvegarder dans localStorage
  localStorage.setItem("wins", stats.wins)
  localStorage.setItem("losses", stats.losses)
}

// Select a game
function selectGame(game) {
  console.log(`Jeu sélectionné: ${game}`);

  // ✅ Handle Rock Paper Scissors separately
  if (game === "rock-paper-scissors") {
    currentGame = game;
    document.querySelector(".game-selection").style.display = "none";
    document.getElementById("game-title").innerText = "Rock Paper Scissors";
    document.getElementById("game-container").style.display = "block";
    document.getElementById("rps-game").style.display = "block";
    playSound("click");
    return; // prevent fall-through
  }

  // ✅ Handle checkers (as you already had)
  if (game === "checkers") {
    currentGame = game;
    document.querySelector(".game-selection").style.display = "none";
    document.getElementById("mode-selection").style.display = "block";
    playSound("click");
    return;
  }

  // ✅ Fallback for other games (Tic-Tac-Toe, Connect Four, etc.)
  currentGame = game;
  document.querySelector(".game-selection").style.display = "none";
  document.getElementById("mode-selection").style.display = "block";
  playSound("click");
}


// Retourner à la sélection de jeu
function backToGameSelection() {
  document.getElementById("mode-selection").style.display = "none"
  document.getElementById("game-container").style.display = "none"
  document.getElementById("join-room-interface").style.display = "none"
  document.querySelector(".game-selection").style.display = "block"

  // Réinitialiser les variables de jeu
  currentGame = null
  gameState = null
  roomId = null
  mode = null
  playerSymbol = null
  waitingForOpponent = false
  onlineGameActive = false

  playSound("click")
}

// Démarrer une partie
function startGame(selectedMode) {
  console.log(`Mode sélectionné: ${selectedMode}`)
  mode = selectedMode

  if (mode === "online") {
    if (!socketConnected) {
      showNotification("Impossible de jouer en ligne. Vérifiez votre connexion au serveur.", "error")
      return
    }

    document.getElementById("mode-selection").style.display = "none"
    document.getElementById("join-room-interface").style.display = "block"
  } else {
    initializeGame()
  }

  playSound("click")
}

// Initialiser une partie
function initializeGame() {
  console.log(`Initialisation du jeu: ${currentGame}, mode: ${mode}`)

  document.getElementById("mode-selection").style.display = "none"
  document.getElementById("join-room-interface").style.display = "none"
  document.getElementById("game-container").style.display = "block"

  // Mettre à jour le titre du jeu
  const gameNames = {
    "tic-tac-toe": "Tic-Tac-Toe",
    "connect-four": "Connect Four",
    checkers: "Memory",
  }

  const modeNames = {
    solo: "Solo",
    local: "Local",
    online: "En ligne",
  }

  document.getElementById("game-title").textContent = `${gameNames[currentGame]} - ${modeNames[mode]}`

  // Afficher/masquer les éléments en fonction du mode
  document.getElementById("online-game-info").style.display = mode === "online" ? "block" : "none"
  document.getElementById("toggle-chat").style.display = mode === "online" ? "inline-block" : "none"
  document.getElementById("difficulty-selector").style.display = mode === "solo" ? "flex" : "none"
  document.getElementById("scoreboard").style.display = mode === "local" ? "flex" : "none"
  initializeDifficultySelector()

  // Cacher le timer de tour
  document.getElementById("turn-timer").style.display = "none"

  if (mode === "local") {
    // Mettre à jour le scoreboard
    document.getElementById("score-x").textContent = localGameState.scoreX
    document.getElementById("score-o").textContent = localGameState.scoreO
  }

  // Initialiser le jeu
  if (currentGame === "tic-tac-toe") {
    initializeTicTacToe()
  } else if (currentGame === "connect-four") {
    initializeConnectFour()
  } else if (currentGame === "checkers") {
    initializeCheckers()
  }

  if (mode === "online") {
    updateOnlineGameInfo()
  }

  playSound("notification")
}

// Initialiser le jeu Tic-Tac-Toe
function initializeTicTacToe() {
  const gameArea = document.getElementById("game-area")
  if (!gameArea) return

  // Initialiser l'état du jeu
  if (mode !== "online") {
    gameState = {
      board: Array(9).fill(""),
      currentPlayer: "X",
      gameOver: false,
      winner: null,
      isDraw: false,
      winningPattern: null,
    }
  }

  // Créer la grille
  gameArea.innerHTML = `
    <div class="tic-tac-toe">
      ${Array(9)
        .fill()
        .map(
          (_, i) => `
        <div data-index="${i}" class="tic-tac-toe-cell"></div>
      `,
        )
        .join("")}
    </div>
  `

  // Ajouter les événements de clic
  const cells = gameArea.querySelectorAll(".tic-tac-toe-cell")
  cells.forEach((cell) => {
    cell.addEventListener("click", () => {
      const index = Number.parseInt(cell.dataset.index)
      makeMove(index)
    })
  })

  // Mettre à jour l'affichage
  updateBoardFromGameState()

  // Mettre à jour le joueur actuel
  updateCurrentPlayerInfo()
}

// Initialiser le jeu Connect Four
function initializeConnectFour() {
  const gameArea = document.getElementById("game-area")
  if (!gameArea) return

  // Initialiser l'état du jeu
  if (mode !== "online") {
    gameState = {
      board: Array(42).fill(""), // Grille 7x6
      currentPlayer: "X", // X = rouge, O = jaune
      gameOver: false,
      winner: null,
      isDraw: false,
      winningPattern: null,
    }
  }

  // Créer la grille
  gameArea.innerHTML = `
    <div class="connect-four-container">
      <div class="connect-four-board">
        <div class="connect-four-columns">
          ${Array(7)
            .fill()
            .map(
              (_, i) => `
            <div class="connect-four-column" data-column="${i}">
              ${Array(6)
                .fill()
                .map(
                  (_, j) => `
                <div class="connect-four-cell" data-row="${5 - j}" data-column="${i}"></div>
              `,
                )
                .join("")}
            </div>
          `,
            )
            .join("")}
        </div>
        <div class="connect-four-disc-preview"></div>
      </div>
    </div>
  `

  // Ajouter les événements de clic et survol
  const columns = gameArea.querySelectorAll(".connect-four-column")
  columns.forEach((column) => {
    column.addEventListener("click", () => {
      const columnIndex = Number.parseInt(column.dataset.column)
      makeConnectFourMove(columnIndex)
    })

    // Prévisualisation du jeton
    column.addEventListener("mouseenter", (e) => {
      if (gameState.gameOver) return
      if (mode === "online" && (!onlineGameActive || waitingForOpponent || gameState.currentPlayer !== playerSymbol))
        return

      const columnIndex = Number.parseInt(column.dataset.column)
      const discPreview = document.querySelector(".connect-four-disc-preview")

      // Vérifier si la colonne est pleine
      const isColumnFull = isConnectFourColumnFull(columnIndex)

      if (isColumnFull) {
        discPreview.style.display = "none"
        return
      }

      discPreview.style.display = "block"
      discPreview.className = `connect-four-disc player-${gameState.currentPlayer.toLowerCase()}`
      discPreview.style.left = `${columnIndex * (100 / 7)}%`
    })

    column.addEventListener("mouseleave", () => {
      const discPreview = document.querySelector(".connect-four-disc-preview")
      discPreview.style.display = "none"
    })
  })

  // Mettre à jour l'affichage
  updateConnectFourBoardFromGameState()

  // Mettre à jour le joueur actuel
  updateCurrentPlayerInfo()
}

// Vérifier si une colonne est pleine
function isConnectFourColumnFull(columnIndex) {
  // Vérifier la cellule du haut de la colonne
  for (let row = 0; row < 6; row++) {
    const cellIndex = row * 7 + columnIndex
    if (gameState.board[cellIndex] === "") {
      return false
    }
  }
  return true
}

// Trouver la première cellule vide dans une colonne
function findEmptyCellInColumn(columnIndex) {
  for (let row = 5; row >= 0; row--) {
    const cellIndex = row * 7 + columnIndex
    if (gameState.board[cellIndex] === "") {
      return cellIndex
    }
  }
  return -1 // Colonne pleine
}

// Faire un mouvement dans Connect Four
function makeConnectFourMove(columnIndex) {
  if (isProcessing) return

  if (gameState.gameOver) {
    return
  }

  // Trouver la première cellule vide dans la colonne
  const cellIndex = findEmptyCellInColumn(columnIndex)

  // Si la colonne est pleine, ne rien faire
  if (cellIndex === -1) {
    return
  }

  if (mode === "online") {
    if (!socketConnected) {
      showNotification("Impossible de jouer. Vérifiez votre connexion au serveur.", "error")
      return
    }

    if (!onlineGameActive || waitingForOpponent) {
      showNotification("En attente d'un adversaire pour commencer la partie", "warning")
      return
    }

    if (gameState.currentPlayer !== playerSymbol) {
      showNotification("Ce n'est pas votre tour", "warning")
      return
    }

    // Ajouter une classe pour indiquer que le mouvement est en attente
    const column = document.querySelector(`[data-column="${columnIndex}"]`)
    if (column) {
      column.classList.add("move-pending")
    }

    isProcessing = true
    socket.emit("gameMove", { roomId, move: cellIndex, playerSymbol })
    playSound("click")
    return
  }

  // Mode local ou solo
  const newBoard = [...gameState.board]
  newBoard[cellIndex] = gameState.currentPlayer

  // Vérifier s'il y a un gagnant
  const winResult = checkConnectFourWin(newBoard, cellIndex)
  const isDraw = !winResult && !newBoard.includes("")

  // Mettre à jour l'état du jeu
  gameState = {
    ...gameState,
    board: newBoard,
    currentPlayer: gameState.currentPlayer === "X" ? "O" : "X",
    gameOver: !!winResult || isDraw,
    winner: winResult ? winResult.winner : null,
    isDraw,
    winningPattern: winResult ? winResult.pattern : null,
  }

  // Mettre à jour l'affichage
  updateConnectFourBoardFromGameState()

  // Ajouter une animation
  animateDiscDrop(columnIndex, cellIndex)
  playSound("move")

  // Si le jeu est terminé
  if (gameState.gameOver) {
    if (winResult) {
      if (mode === "local") {
        // Mettre à jour le score local
        if (winResult.winner === "X") {
          localGameState.scoreX++
        } else {
          localGameState.scoreO++
        }

        document.getElementById("score-x").textContent = localGameState.scoreX
        document.getElementById("score-o").textContent = localGameState.scoreO

        localStorage.setItem("scoreX", localGameState.scoreX)
        localStorage.setItem("scoreO", localGameState.scoreO)
      } else if (mode === "solo") {
        // Mettre à jour les statistiques
        if (winResult.winner === "X") {
          stats.wins++
          showConfetti()
          playSound("win")
        } else {
          stats.losses++
          playSound("lose")
        }

        updateStats()
        updateServerStats()

        // Ajouter à l'historique
        addGameToHistory(currentGame, winResult.winner === "X" ? "win" : "lose")

        // Vérifier les succès
        checkAchievements()
      }

      highlightConnectFourWinningCells(winResult.pattern)
    } else if (isDraw) {
      playSound("draw")

      // Ajouter à l'historique
      if (mode === "solo") {
        addGameToHistory(currentGame, "draw")
      }
    }

    return
  }

  // Si c'est le tour de l'IA en mode solo
  if (mode === "solo" && gameState.currentPlayer === "O" && !gameState.gameOver) {
    isProcessing = true

    // Simuler un délai pour l'IA
    setTimeout(() => {
      const aiMove = getConnectFourAIMove(gameState.board, difficulty)

      // Trouver la première cellule vide dans la colonne choisie par l'IA
      const aiCellIndex = findEmptyCellInColumn(aiMove)

      if (aiCellIndex !== -1) {
        const newBoard = [...gameState.board]
        newBoard[aiCellIndex] = "O"

        // Vérifier s'il y a un gagnant
        const winResult = checkConnectFourWin(newBoard, aiCellIndex)
        const isDraw = !winResult && !newBoard.includes("")

        // Mettre à jour l'état du jeu
        gameState = {
          ...gameState,
          board: newBoard,
          currentPlayer: "X",
          gameOver: !!winResult || isDraw,
          winner: winResult ? winResult.winner : null,
          isDraw,
          winningPattern: winResult ? winResult.pattern : null,
        }

        // Mettre à jour l'affichage
        updateConnectFourBoardFromGameState()

        // Ajouter une animation
        animateDiscDrop(aiMove, aiCellIndex)
        playSound("move")

        // Si le jeu est terminé
        if (gameState.gameOver) {
          if (winResult) {
            // Mettre à jour les statistiques
            stats.losses++
            updateStats()
            updateServerStats()

            // Ajouter à l'historique
            addGameToHistory(currentGame, "lose")

            playSound("lose")
            highlightConnectFourWinningCells(winResult.pattern)
          } else if (isDraw) {
            playSound("draw")

            // Ajouter à l'historique
            addGameToHistory(currentGame, "draw")
          }
        }
      }

      isProcessing = false
    }, 1000)
  }
}

// Animer la chute d'un jeton
function animateDiscDrop(columnIndex, cellIndex) {
  const row = Math.floor(cellIndex / 7)
  const cell = document.querySelector(`.connect-four-cell[data-row="${row}"][data-column="${columnIndex}"]`)

  if (cell) {
    // Créer un élément pour l'animation
    const disc = document.createElement("div")
    disc.className = `connect-four-disc player-${gameState.board[cellIndex].toLowerCase()} dropping`

    // Ajouter le jeton à la cellule
    cell.appendChild(disc)

    // Jouer le son de chute
    playSound("move")

    // Supprimer la classe d'animation après la fin de l'animation
    setTimeout(() => {
      disc.classList.remove("dropping")
    }, 500)
  }
}

// Mettre à jour l'affichage du plateau Connect Four
function updateConnectFourBoardFromGameState() {
  if (!gameState || !gameState.board) return

  // Effacer tous les jetons existants
  const cells = document.querySelectorAll(".connect-four-cell")
  cells.forEach((cell) => {
    cell.innerHTML = ""
  })

  // Ajouter les jetons selon l'état du jeu
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 7; col++) {
      const index = row * 7 + col
      const value = gameState.board[index]

      if (value) {
        const cell = document.querySelector(`.connect-four-cell[data-row="${row}"][data-column="${col}"]`)
        if (cell) {
          const disc = document.createElement("div")
          disc.className = `connect-four-disc player-${value.toLowerCase()}`

          // Ajouter la classe winning-cell si cette cellule fait partie du motif gagnant
          if (gameState.winningPattern && gameState.winningPattern.includes(index)) {
            disc.classList.add("winning-disc")
          }

          cell.appendChild(disc)
        }
      }
    }
  }

  updateCurrentPlayerInfo()
  updateGameResult()
}

// Mettre en évidence les cellules gagnantes
function highlightConnectFourWinningCells(pattern) {
  if (!pattern) return

  pattern.forEach((index) => {
    const row = Math.floor(index / 7)
    const col = index % 7
    const cell = document.querySelector(`.connect-four-cell[data-row="${row}"][data-column="${col}"]`)

    if (cell && cell.firstChild) {
      cell.firstChild.classList.add("winning-disc")
    }
  })
}

// Vérifier s'il y a un gagnant au Connect Four
function checkConnectFourWin(board, lastMove) {
  if (lastMove === undefined || lastMove === null) return null

  const row = Math.floor(lastMove / 7)
  const col = lastMove % 7
  const player = board[lastMove]

  if (!player) return null

  // Vérifier horizontalement
  for (let c = Math.max(0, col - 3); c <= Math.min(3, col); c++) {
    const cells = [row * 7 + c, row * 7 + c + 1, row * 7 + c + 2, row * 7 + c + 3]

    if (cells.every((i) => board[i] === player)) {
      return { winner: player, pattern: cells }
    }
  }

  // Vérifier verticalement
  for (let r = Math.max(0, row - 3); r <= Math.min(2, row); r++) {
    const cells = [r * 7 + col, (r + 1) * 7 + col, (r + 2) * 7 + col, (r + 3) * 7 + col]

    if (cells.every((i) => board[i] === player)) {
      return { winner: player, pattern: cells }
    }
  }

  // Vérifier diagonale (haut-gauche à bas-droite)
  for (
    let r = Math.max(0, row - 3), c = Math.max(0, col - 3);
    r <= Math.min(2, row) && c <= Math.min(3, col);
    r++, c++
  ) {
    const cells = [r * 7 + c, (r + 1) * 7 + (c + 1), (r + 2) * 7 + (c + 2), (r + 3) * 7 + (c + 3)]

    if (cells.every((i) => i >= 0 && i < 42 && board[i] === player)) {
      return { winner: player, pattern: cells }
    }
  }

  // Vérifier diagonale (haut-droite à bas-gauche)
  for (
    let r = Math.max(0, row - 3), c = Math.min(6, col + 3);
    r <= Math.min(2, row) && c >= Math.max(3, col);
    r++, c--
  ) {
    const cells = [r * 7 + c, (r + 1) * 7 + (c - 1), (r + 2) * 7 + (c - 2), (r + 3) * 7 + (c - 3)]

    if (cells.every((i) => i >= 0 && i < 42 && board[i] === player)) {
      return { winner: player, pattern: cells }
    }
  }

  return null
}

// IA pour Connect Four
function getConnectFourAIMove(board, difficulty) {
  // Trouver les colonnes qui ne sont pas pleines
  const availableColumns = []
  for (let col = 0; col < 7; col++) {
    if (!isConnectFourColumnFull(col)) {
      availableColumns.push(col)
    }
  }

  if (availableColumns.length === 0) return -1

  // Stratégie en fonction de la difficulté
  if (difficulty === "facile") {
    // Mouvement aléatoire
    return availableColumns[Math.floor(Math.random() * availableColumns.length)]
  }

  // Pour les difficultés moyenne et difficile, vérifier les mouvements gagnants et bloquants

  // Vérifier si l'IA peut gagner en un coup
  for (const col of availableColumns) {
    const cellIndex = findEmptyCellInColumn(col)
    if (cellIndex !== -1) {
      const tempBoard = [...board]
      tempBoard[cellIndex] = "O"
      if (checkConnectFourWin(tempBoard, cellIndex)) {
        return col
      }
    }
  }

  // Vérifier si le joueur peut gagner en un coup et bloquer
  for (const col of availableColumns) {
    const cellIndex = findEmptyCellInColumn(col)
    if (cellIndex !== -1) {
      const tempBoard = [...board]
      tempBoard[cellIndex] = "X"
      if (checkConnectFourWin(tempBoard, cellIndex)) {
        return col
      }
    }
  }

  if (difficulty === "difficile") {
    // Stratégie avancée: préférer la colonne centrale
    if (availableColumns.includes(3)) {
      return 3
    }

    // Préférer les colonnes adjacentes au centre
    const preferredColumns = [2, 4, 1, 5, 0, 6]
    for (const col of preferredColumns) {
      if (availableColumns.includes(col)) {
        return col
      }
    }
  }

  // Stratégie par défaut: choisir une colonne aléatoire
  return availableColumns[Math.floor(Math.random() * availableColumns.length)]
}

// Mettre à jour l'affichage du joueur actuel
function updateCurrentPlayerInfo() {
  const currentPlayerEl = document.getElementById("current-player")
  if (!currentPlayerEl) return

  if (gameState.gameOver) {
    currentPlayerEl.textContent = ""
    return
  }

  if (mode === "online") {
    if (waitingForOpponent) {
      currentPlayerEl.textContent = "En attente d'un adversaire..."
      currentPlayerEl.className = "game-status waiting"
    } else if (!onlineGameActive) {
      currentPlayerEl.textContent = "La partie n'a pas encore commencé"
      currentPlayerEl.className = "game-status waiting"
    } else {
      const isYourTurn = gameState.currentPlayer === playerSymbol
      currentPlayerEl.textContent = isYourTurn ? "C'est votre tour" : "Tour de l'adversaire"
      currentPlayerEl.className = isYourTurn ? "game-status your-turn" : "game-status opponent-turn"
    }
  } else if (mode === "solo" && gameState.currentPlayer === "O") {
    currentPlayerEl.textContent = "Tour de l'IA (O)"
    currentPlayerEl.className = "game-status ai-turn"
  } else {
    currentPlayerEl.textContent = `Tour du joueur ${gameState.currentPlayer}`
    currentPlayerEl.className = `game-status player-${gameState.currentPlayer.toLowerCase()}-turn`
  }
}

// Mettre à jour l'affichage du résultat
function updateGameResult() {
  const gameResultEl = document.getElementById("game-result")
  if (!gameResultEl) return

  if (!gameState.gameOver) {
    gameResultEl.textContent = ""
    gameResultEl.className = "game-result"
    return
  }

  if (mode === "online") {
    const isWinner = gameState.winner === playerSymbol
    if (gameState.isDraw) {
      gameResultEl.textContent = "Match nul!"
      gameResultEl.className = "game-result draw"
    } else {
      gameResultEl.textContent = isWinner ? "Vous avez gagné!" : "Votre adversaire a gagné"
      gameResultEl.className = isWinner ? "game-result win" : "game-result lose"
    }
  } else if (gameState.isDraw) {
    gameResultEl.textContent = "Match nul!"
    gameResultEl.className = "game-result draw"
  } else if (gameState.winner) {
    const winnerText =
      mode === "solo" && gameState.winner === "O" ? "L'IA a gagné!" : `Joueur ${gameState.winner} a gagné!`

    gameResultEl.textContent = winnerText
    gameResultEl.className = `game-result player-${gameState.winner.toLowerCase()}-win`
  }
}

// Mettre à jour l'affichage du plateau à partir de l'état du jeu
function updateBoardFromGameState() {
  if (!gameState || !gameState.board) return

  const cells = document.querySelectorAll(".tic-tac-toe-cell")
  if (!cells.length) return

  cells.forEach((cell, index) => {
    cell.textContent = gameState.board[index]
    cell.className = "tic-tac-toe-cell"

    if (gameState.board[index]) {
      cell.classList.add(`player-${gameState.board[index].toLowerCase()}`)
    }

    if (gameState.winningPattern && gameState.winningPattern.includes(index)) {
      cell.classList.add("winning-cell")
    }
  })

  updateCurrentPlayerInfo()
  updateGameResult()
}

// Mettre en évidence les cellules gagnantes
function highlightWinningCells(pattern) {
  if (!pattern) return

  const cells = document.querySelectorAll(".tic-tac-toe-cell")
  pattern.forEach((index) => {
    cells[index].classList.add("winning-cell")
  })
}

// Faire un mouvement
function makeMove(index) {
  if (isProcessing) return

  if (gameState.gameOver || gameState.board[index] !== "") {
    return
  }

  if (mode === "online") {
    if (!socketConnected) {
      showNotification("Impossible de jouer. Vérifiez votre connexion au serveur.", "error")
      return
    }

    if (!onlineGameActive || waitingForOpponent) {
      showNotification("En attente d'un adversaire pour commencer la partie", "warning")
      return
    }

    if (gameState.currentPlayer !== playerSymbol) {
      showNotification("Ce n'est pas votre tour", "warning")
      return
    }

    // Ajouter une classe pour indiquer que le mouvement est en attente
    const cell = document.querySelector(`[data-index="${index}"]`)
    if (cell) {
      cell.classList.add("move-pending")
    }

    isProcessing = true
    socket.emit("gameMove", { roomId, move: index, playerSymbol })
    playSound("click")
    return
  }

  // Mode local ou solo
  const newBoard = [...gameState.board]
  newBoard[index] = gameState.currentPlayer

  // Vérifier s'il y a un gagnant
  const winResult = checkWin(newBoard)
  const isDraw = !winResult && !newBoard.includes("")

  // Mettre à jour l'état du jeu
  gameState = {
    ...gameState,
    board: newBoard,
    currentPlayer: gameState.currentPlayer === "X" ? "O" : "X",
    gameOver: !!winResult || isDraw,
    winner: winResult ? winResult.winner : null,
    isDraw,
    winningPattern: winResult ? winResult.pattern : null,
  }

  // Mettre à jour l'affichage
  updateBoardFromGameState()

  // Ajouter une animation
  const cell = document.querySelector(`[data-index="${index}"]`)
  if (cell) {
    cell.classList.add("animated-placement")
  }

  playSound("move")

  // Si le jeu est terminé
  if (gameState.gameOver) {
    if (winResult) {
      if (mode === "local") {
        // Mettre à jour le score local
        if (winResult.winner === "X") {
          localGameState.scoreX++
        } else {
          localGameState.scoreO++
        }

        document.getElementById("score-x").textContent = localGameState.scoreX
        document.getElementById("score-o").textContent = localGameState.scoreO

        localStorage.setItem("scoreX", localGameState.scoreX)
        localStorage.setItem("scoreO", localGameState.scoreO)
      } else if (mode === "solo") {
        // Mettre à jour les statistiques
        if (winResult.winner === "X") {
          stats.wins++
          showConfetti()
          playSound("win")
        } else {
          stats.losses++
          playSound("lose")
        }

        updateStats()
        updateServerStats()

        // Ajouter à l'historique
        addGameToHistory(currentGame, winResult.winner === "X" ? "win" : "lose")

        // Vérifier les succès
        checkAchievements()
      }

      highlightWinningCells(winResult.pattern)
    } else if (isDraw) {
      playSound("draw")

      // Ajouter à l'historique
      if (mode === "solo") {
        addGameToHistory(currentGame, "draw")
      }
    }

    return
  }

  // Si c'est le tour de l'IA en mode solo
  if (mode === "solo" && gameState.currentPlayer === "O" && !gameState.gameOver) {
    isProcessing = true

    // Simuler un délai pour l'IA
    setTimeout(() => {
      const aiMove = getAIMove(gameState.board, difficulty)

      // Vérifier que le coup est valide
      if (gameState.board[aiMove] === "") {
        const newBoard = [...gameState.board]
        newBoard[aiMove] = "O"

        // Vérifier s'il y a un gagnant
        const winResult = checkWin(newBoard)
        const isDraw = !winResult && !newBoard.includes("")

        // Mettre à jour l'état du jeu
        gameState = {
          ...gameState,
          board: newBoard,
          currentPlayer: "X",
          gameOver: !!winResult || isDraw,
          winner: winResult ? winResult.winner : null,
          isDraw,
          winningPattern: winResult ? winResult.pattern : null,
        }

        // Mettre à jour l'affichage
        updateBoardFromGameState()

        // Ajouter une animation
        const cell = document.querySelector(`[data-index="${aiMove}"]`)
        if (cell) {
          cell.classList.add("animated-placement")
        }

        playSound("move")

        // Si le jeu est terminé
        if (gameState.gameOver) {
          if (winResult) {
            // Mettre à jour les statistiques
            stats.losses++
            updateStats()
            updateServerStats()

            // Ajouter à l'historique
            addGameToHistory(currentGame, "lose")

            playSound("lose")
          } else if (isDraw) {
            playSound("draw")

            // Ajouter à l'historique
            addGameToHistory(currentGame, "draw")
          }
        }
      }

      isProcessing = false
    }, 1000)
  }
}

// Obtenir un mouvement de l'IA
function getAIMove(board, difficulty) {
  // Implémentation simple pour l'exemple
  // Une vraie IA utiliserait l'algorithme minimax

  // Vérifier si l'IA peut gagner
  const winMove = findWinningMove(board, "O")
  if (winMove !== -1) return winMove

  // Vérifier si le joueur peut gagner et bloquer
  const blockMove = findWinningMove(board, "X")
  if (blockMove !== -1) return blockMove

  // Stratégie en fonction de la difficulté
  if (difficulty === "facile") {
    // Mouvement aléatoire
    const emptyCells = board.map((cell, index) => (cell === "" ? index : -1)).filter((index) => index !== -1)
    return emptyCells[Math.floor(Math.random() * emptyCells.length)]
  } else if (difficulty === "difficile") {
    // Stratégie avancée
    // Prendre le centre s'il est libre
    if (board[4] === "") return 4

    // Prendre un coin s'il est libre
    const corners = [0, 2, 6, 8]
    const emptyCorners = corners.filter((index) => board[index] === "")
    if (emptyCorners.length > 0) {
      return emptyCorners[Math.floor(Math.random() * emptyCorners.length)]
    }

    // Prendre un côté s'il est libre
    const sides = [1, 3, 5, 7]
    const emptySides = sides.filter((index) => board[index] === "")
    if (emptySides.length > 0) {
      return emptySides[Math.floor(Math.random() * emptySides.length)]
    }
  } else {
    // Difficulté moyenne (par défaut)
    // Prendre le centre s'il est libre
    if (board[4] === "") return 4

    // Sinon, mouvement semi-aléatoire
    const emptyCells = board.map((cell, index) => (cell === "" ? index : -1)).filter((index) => index !== -1)
    return emptyCells[Math.floor(Math.random() * emptyCells.length)]
  }

  // Fallback: mouvement aléatoire
  const emptyCells = board.map((cell, index) => (cell === "" ? index : -1)).filter((index) => index !== -1)
  return emptyCells[Math.floor(Math.random() * emptyCells.length)]
}

// Trouver un mouvement gagnant
function findWinningMove(board, player) {
  const winPatterns = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8], // lignes
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8], // colonnes
    [0, 4, 8],
    [2, 4, 6], // diagonales
  ]

  for (const pattern of winPatterns) {
    const [a, b, c] = pattern
    if (board[a] === player && board[b] === player && board[c] === "") return c
    if (board[a] === player && board[c] === player && board[b] === "") return b
    if (board[b] === player && board[c] === player && board[a] === "") return a
  }

  return -1
}

// Vérifier s'il y a un gagnant
function checkWin(board) {
  const winPatterns = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8], // lignes
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8], // colonnes
    [0, 4, 8],
    [2, 4, 6], // diagonales
  ]

  for (const pattern of winPatterns) {
    const [a, b, c] = pattern
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return {
        winner: board[a],
        pattern,
      }
    }
  }

  return null
}

// Réinitialiser le jeu
function resetGame() {
  if (isProcessing) return

  if (mode === "online") {
    if (!socketConnected) {
      showNotification("Impossible de réinitialiser. Vérifiez votre connexion au serveur.", "error")
      return
    }

    if (!roomId) {
      showNotification("Impossible de réinitialiser. Salle non trouvée.", "error")
      return
    }

    isProcessing = true
    socket.emit("resetGame", { roomId })
    playSound("click")
    return
  }

  // Mode local ou solo
  if (currentGame === "connect-four") {
    // Réinitialiser pour Connect Four (grille 7x6 = 42 cellules)
    gameState = {
      board: Array(42).fill(""),
      currentPlayer: "X",
      gameOver: false,
      winner: null,
      isDraw: false,
      winningPattern: null,
    }

    // Mettre à jour l'affichage spécifique à Connect Four
    updateConnectFourBoardFromGameState()
  } else if (currentGame === "checkers") {
    // Je remplace uniquement les fonctions liées au jeu de Checkers
    // Voici la nouvelle implémentation pour un jeu de Memory (jeu de mémoire)

    // Initialiser le jeu Memory
    const gameArea = document.getElementById("game-area")
    if (!gameArea) return

    // Initialiser l'état du jeu
    if (mode !== "online") {
      gameState = {
        board: generateMemoryBoard(),
        currentPlayer: "X", // X = joueur 1, O = joueur 2 ou IA
        gameOver: false,
        winner: null,
        isDraw: false,
        flippedCards: [], // Cartes actuellement retournées
        matchedPairs: [], // Paires trouvées
        scoreX: 0, // Score du joueur X
        scoreO: 0, // Score du joueur O
      }
    }

    // Créer le plateau de jeu Memory
    gameArea.innerHTML = `
    <div class="memory-board">
      ${Array(16)
        .fill()
        .map(
          (_, index) => `
        <div class="memory-card" data-index="${index}">
          <div class="memory-card-inner">
            <div class="memory-card-front">
              <span>?</span>
            </div>
            <div class="memory-card-back">
              <span>${gameState.board[index].emoji}</span>
            </div>
          </div>
        </div>
      `,
        )
        .join("")}
    </div>
  `

    // Ajouter les événements de clic
    const cards = gameArea.querySelectorAll(".memory-card")
    cards.forEach((card) => {
      const index = Number.parseInt(card.dataset.index)
      card.addEventListener("click", () => {
        makeMemoryMove(index)
      })
    })

    // Mettre à jour l'affichage
    updateMemoryBoardFromGameState()

    // Mettre à jour le joueur actuel
    updateCurrentPlayerInfo()
  } else {
    // Réinitialiser pour Tic-Tac-Toe (grille 3x3 = 9 cellules)
    gameState = {
      board: Array(9).fill(""),
      currentPlayer: "X",
      gameOver: false,
      winner: null,
      isDraw: false,
      winningPattern: null,
    }

    // Mettre à jour l'affichage pour Tic-Tac-Toe
    updateBoardFromGameState()
  }

  // Réinitialiser l'affichage du joueur actuel
  updateCurrentPlayerInfo()

  // Réinitialiser l'affichage du résultat
  const gameResultEl = document.getElementById("game-result")
  if (gameResultEl) {
    gameResultEl.textContent = ""
    gameResultEl.className = "game-result"
  }

  playSound("click")
}

// Créer une salle
function createRoomFunc() {
  if (!socketConnected) {
    showNotification("Impossible de créer une salle. Vérifiez votre connexion au serveur.", "error")
    return
  }

  socket.emit("createRoom", { gameType: currentGame, mode: "online" })

  document.getElementById("join-room-interface").style.display = "none"
  document.getElementById("game-container").style.display = "block"

  showNotification("Création de la salle en cours...", "info")
}

// Rejoindre une salle
function joinRoomFunc(roomId) {
  if (!socketConnected) {
    showNotification("Impossible de rejoindre une salle. Vérifiez votre connexion au serveur.", "error")
    return
  }

  socket.emit("joinRoom", { roomId: roomId.trim() })

  document.getElementById("join-room-interface").style.display = "none"
  document.getElementById("game-container").style.display = "block"

  showNotification("Connexion à la salle en cours...", "info")
}

// Mettre à jour les informations de jeu en ligne
function updateOnlineGameInfo(opponentName = null) {
  const roomIdDisplay = document.getElementById("room-id-display")
  const playerSymbolEl = document.getElementById("player-symbol")
  const opponentNameEl = document.getElementById("opponent-name")

  if (roomIdDisplay) {
    roomIdDisplay.textContent = roomId || "------"
  }

  if (playerSymbolEl) {
    playerSymbolEl.textContent = playerSymbol || "?"
  }

  if (opponentNameEl) {
    if (waitingForOpponent) {
      opponentNameEl.textContent = "En attente..."
    } else if (opponentName) {
      opponentNameEl.textContent = opponentName
    }
  }

  // Bouton de copie de l'ID
  const copyRoomIdBtn = document.getElementById("copy-room-id")
  if (copyRoomIdBtn) {
    copyRoomIdBtn.onclick = () => {
      if (!roomId) return

      navigator.clipboard
        .writeText(roomId)
        .then(() => {
          showNotification("ID de salle copié dans le presse-papier", "success")
          playSound("click")
        })
        .catch(() => {
          showNotification("Impossible de copier l'ID", "error")
        })
    }
  }

  // Bouton de partage
  const shareRoomBtn = document.getElementById("share-room")
  if (shareRoomBtn) {
    shareRoomBtn.onclick = () => {
      if (!roomId) return

      if (navigator.share) {
        navigator
          .share({
            title: "Rejoins ma partie de GameVerse!",
            text: "Rejoins ma partie de jeu sur GameVerse!",
            url: `${window.location.origin}?room=${roomId}`,
          })
          .catch((error) => {
            console.error("Erreur de partage", error)
          })
      } else {
        // Fallback si l'API Web Share n'est pas disponible
        navigator.clipboard
          .writeText(roomId)
          .then(() => {
            showNotification("ID de salle copié dans le presse-papier", "success")
            playSound("click")
          })
          .catch(() => {
            showNotification("Impossible de copier l'ID", "error")
          })
      }
    }
  }
}

// Démarrer le timer de tour
function startTurnTimer(seconds) {
  const timerEl = document.getElementById("turn-timer")
  const timerProgressEl = document.querySelector(".timer-progress")
  const timerTextEl = document.querySelector(".timer-text")

  if (!timerEl || !timerProgressEl || !timerTextEl) return

  timerEl.style.display = "block"
  timerProgressEl.style.width = "100%"
  timerTextEl.textContent = `${seconds}s`

  // Démarrer l'animation
  timerProgressEl.style.transition = `width ${seconds}s linear`
  setTimeout(() => {
    timerProgressEl.style.width = "0%"
  }, 50)
}

// Arrêter le timer de tour
function stopTurnTimer() {
  const timerEl = document.getElementById("turn-timer")
  if (!timerEl) return

  timerEl.style.display = "none"
}

// Mettre à jour le timer de tour
function updateTurnTimer(seconds) {
  const timerTextEl = document.querySelector(".timer-text")
  if (!timerTextEl) return

  timerTextEl.textContent = `${seconds}s`
}

// Afficher une notification
function showNotification(message, type = "info") {
  const notification = document.getElementById("notification")
  if (!notification) return

  notification.textContent = message
  notification.className = `notification ${type}`
  notification.style.display = "block"

  // Ajouter la classe show après un court délai pour l'animation
  setTimeout(() => {
    notification.classList.add("show")
  }, 10)

  // Masquer la notification après 5 secondes
  setTimeout(() => {
    notification.classList.remove("show")
    setTimeout(() => {
      notification.style.display = "none"
    }, 300)
  }, 5000)
}

// Afficher des confettis
function showConfetti() {
  const confettiContainer = document.getElementById("confetti-container")
  if (!confettiContainer) return

  confettiContainer.style.display = "block"
  confettiContainer.innerHTML = ""

  // Créer 100 confettis
  for (let i = 0; i < 100; i++) {
    const confetti = document.createElement("div")
    confetti.className = "confetti"
    confetti.style.left = `${Math.random() * 100}%`
    confetti.style.animationDelay = `${Math.random() * 5}s`
    confetti.style.backgroundColor = confettiColors[Math.floor(Math.random() * confettiColors.length)]
    confetti.style.width = `${Math.random() * 10 + 5}px`
    confetti.style.height = `${Math.random() * 10 + 5}px`

    confettiContainer.appendChild(confetti)
  }

  // Masquer les confettis après 5 secondes
  setTimeout(() => {
    confettiContainer.style.display = "none"
  }, 5000)
}

function initializeDifficultySelector() {
  const difficultyButtons = document.querySelectorAll(".difficulty-btn")

  // Mettre en évidence le bouton de difficulté actuel
  difficultyButtons.forEach((btn) => {
    if (btn.dataset.difficulty === difficulty) {
      btn.classList.add("active")
    }

    btn.addEventListener("click", () => {
      // Retirer la classe active de tous les boutons
      difficultyButtons.forEach((b) => b.classList.remove("active"))

      // Ajouter la classe active au bouton cliqué
      btn.classList.add("active")

      // Mettre à jour la difficulté
      difficulty = btn.dataset.difficulty

      // Sauvegarder dans localStorage
      localStorage.setItem("difficulty", difficulty)

      // Notification
      showNotification(`Difficulté changée: ${difficulty}`, "success")
      playSound("click")

      console.log(`Difficulté changée: ${difficulty}`)
    })
  })

  // Show the difficulty selector in the game controls
  const difficultySelector = document.getElementById("difficulty-selector")
  if (difficultySelector && mode === "solo") {
    difficultySelector.style.display = "flex"
  }
}

// Initialiser le jeu Memory
function initializeCheckers() {
  const gameArea = document.getElementById("game-area")
  if (!gameArea) return

  // Initialiser l'état du jeu
  if (mode !== "online") {
    gameState = {
      board: generateMemoryBoard(),
      currentPlayer: "X", // X = joueur 1, O = joueur 2 ou IA
      gameOver: false,
      winner: null,
      isDraw: false,
      flippedCards: [], // Cartes actuellement retournées
      matchedPairs: [], // Paires trouvées
      scoreX: 0, // Score du joueur X
      scoreO: 0, // Score du joueur O
    }
  }

  // Créer le plateau de jeu Memory
  gameArea.innerHTML = `
    <div class="memory-board">
      ${Array(16)
        .fill()
        .map(
          (_, index) => `
        <div class="memory-card" data-index="${index}">
          <div class="memory-card-inner">
            <div class="memory-card-front">
              <span>?</span>
            </div>
            <div class="memory-card-back">
              <span>${gameState.board[index].emoji}</span>
            </div>
          </div>
        </div>
      `,
        )
        .join("")}
    </div>
  `

  // Ajouter les événements de clic
  const cards = gameArea.querySelectorAll(".memory-card")
  cards.forEach((card) => {
    const index = Number.parseInt(card.dataset.index)
    card.addEventListener("click", () => {
      makeMemoryMove(index)
    })
  })

  // Mettre à jour l'affichage
  updateMemoryBoardFromGameState()

  // Mettre à jour le joueur actuel
  updateCurrentPlayerInfo()
}

// Générer un plateau de jeu Memory
function generateMemoryBoard() {
  const emojis = ["🍎", "🍌", "🍒", "🍓", "🍊", "🍋", "🍉", "🍇"]
  const board = []

  // Créer des paires d'emojis
  for (const emoji of emojis) {
    board.push({ emoji, matched: false })
    board.push({ emoji, matched: false })
  }

  // Mélanger le tableau
  for (let i = board.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[board[i], board[j]] = [board[j], board[i]]
  }

  return board
}

// Mettre à jour l'affichage du plateau Memory
function updateMemoryBoardFromGameState() {
  if (!gameState || !gameState.board) return

  const cards = document.querySelectorAll(".memory-card")

  cards.forEach((card, index) => {
    const cardInner = card.querySelector(".memory-card-inner")

    // Réinitialiser les classes
    card.className = "memory-card"

    // Appliquer les états appropriés
    if (gameState.matchedPairs.includes(index)) {
      card.classList.add("matched")
      cardInner.style.transform = "rotateY(180deg)"
    } else if (gameState.flippedCards.includes(index)) {
      cardInner.style.transform = "rotateY(180deg)"
    } else {
      cardInner.style.transform = "rotateY(0deg)"
    }
  })

  // Mettre à jour le score si en mode local
  if (mode === "local") {
    document.getElementById("score-x").textContent = gameState.scoreX
    document.getElementById("score-o").textContent = gameState.scoreO
  }

  updateCurrentPlayerInfo()
  updateGameResult()
}

// Faire un mouvement dans le jeu Memory
function makeMemoryMove(index) {
  if (isProcessing) return

  if (gameState.gameOver || gameState.flippedCards.includes(index) || gameState.matchedPairs.includes(index)) {
    return
  }

  if (mode === "online") {
    if (!socketConnected) {
      showNotification("Impossible de jouer. Vérifiez votre connexion au serveur.", "error")
      return
    }

    if (!onlineGameActive || waitingForOpponent) {
      showNotification("En attente d'un adversaire pour commencer la partie", "warning")
      return
    }

    if (gameState.currentPlayer !== playerSymbol) {
      showNotification("Ce n'est pas votre tour", "warning")
      return
    }

    // Logique pour le mode en ligne
    // À implémenter avec Socket.IO
    return
  }

  // Mode local ou solo
  const newFlippedCards = [...gameState.flippedCards, index]

  // Mettre à jour l'état du jeu
  gameState = {
    ...gameState,
    flippedCards: newFlippedCards,
  }

  // Mettre à jour l'affichage
  updateMemoryBoardFromGameState()
  playSound("move")

  // Si deux cartes sont retournées, vérifier si elles correspondent
  if (newFlippedCards.length === 2) {
    isProcessing = true

    setTimeout(() => {
      const [firstIndex, secondIndex] = newFlippedCards
      const firstCard = gameState.board[firstIndex]
      const secondCard = gameState.board[secondIndex]

      if (firstCard.emoji === secondCard.emoji) {
        // Les cartes correspondent
        const newMatchedPairs = [...gameState.matchedPairs, firstIndex, secondIndex]

        // Mettre à jour le score
        let newScoreX = gameState.scoreX
        let newScoreO = gameState.scoreO

        if (gameState.currentPlayer === "X") {
          newScoreX++
        } else {
          newScoreO++
        }

        // Vérifier si toutes les paires ont été trouvées
        const isGameOver = newMatchedPairs.length === gameState.board.length
        let winner = null

        if (isGameOver) {
          winner = newScoreX > newScoreO ? "X" : newScoreO > newScoreX ? "O" : null
        }

        // Mettre à jour l'état du jeu
        gameState = {
          ...gameState,
          flippedCards: [],
          matchedPairs: newMatchedPairs,
          scoreX: newScoreX,
          scoreO: newScoreO,
          gameOver: isGameOver,
          winner: winner,
          isDraw: isGameOver && winner === null,
        }

        playSound("notification")

        // Afficher le résultat si le jeu est terminé
        if (isGameOver) {
          updateGameResult()
          if (winner === "X" && mode === "solo") {
            showConfetti()
            playSound("win")
            stats.wins++
            updateStats()
            updateServerStats()
            addGameToHistory(currentGame, "win")
          } else if (winner === "O" && mode === "solo") {
            playSound("lose")
            stats.losses++
            updateStats()
            updateServerStats()
            addGameToHistory(currentGame, "lose")
          }
        }
      } else {
        // Les cartes ne correspondent pas, changer de joueur
        gameState = {
          ...gameState,
          flippedCards: [],
          currentPlayer: gameState.currentPlayer === "X" ? "O" : "X",
        }
      }

      // Mettre à jour l'affichage
      updateMemoryBoardFromGameState()

      // Si le jeu est terminé
      if (gameState.gameOver) {
        return
      } else if (mode === "solo" && gameState.currentPlayer === "O") {
        // Tour de l'IA - on laisse un petit délai pour que le joueur voie le changement
        setTimeout(() => {
          makeMemoryAIMove()
        }, 500)
      }

      isProcessing = false
    }, 1000)
  }
}

function makeMemoryAIMove() {
  if (isProcessing) return
  isProcessing = true

  // Simuler un délai pour l'IA
  setTimeout(() => {
    // Première carte à retourner
    let firstCardIndex = -1

    // Stratégie basée sur la difficulté
    const knownCards = {} // Stocke les cartes déjà vues

    // Probabilité que l'IA "oublie" une carte qu'elle a vue
    let forgetProbability = 0
    if (difficulty === "facile") {
      forgetProbability = 0.7 // 70% de chance d'oublier en mode facile
    } else if (difficulty === "moyen") {
      forgetProbability = 0.3 // 30% de chance d'oublier en mode moyen
    }
    // En mode difficile, forgetProbability reste à 0 (ne jamais oublier)

    // Parcourir toutes les cartes qui ne sont pas encore appariées
    for (let i = 0; i < gameState.board.length; i++) {
      if (!gameState.matchedPairs.includes(i)) {
        const emoji = gameState.board[i].emoji

        // Si on a déjà vu cette carte et qu'elle n'est pas la même
        if (knownCards[emoji] !== undefined && knownCards[emoji] !== i) {
          // En mode facile ou moyen, l'IA peut "oublier" des cartes
          if (Math.random() < forgetProbability) {
            continue // L'IA "oublie" cette paire et continue à chercher
          }

          firstCardIndex = i
          const secondCardIndex = knownCards[emoji]

          // Retourner la première carte
          gameState = {
            ...gameState,
            flippedCards: [firstCardIndex],
          }
          updateMemoryBoardFromGameState()
          playSound("move")

          // Retourner la deuxième carte après un court délai
          setTimeout(() => {
            gameState = {
              ...gameState,
              flippedCards: [firstCardIndex, secondCardIndex],
            }
            updateMemoryBoardFromGameState()
            playSound("move")

            // Vérifier la correspondance après un délai
            setTimeout(() => {
              // Les cartes correspondent forcément ici
              const newMatchedPairs = [...gameState.matchedPairs, firstCardIndex, secondCardIndex]

              // Mettre à jour le score
              const newScoreO = gameState.scoreO + 1

              // Vérifier si toutes les paires ont été trouvées
              const isGameOver = newMatchedPairs.length === gameState.board.length
              let winner = null

              if (isGameOver) {
                winner = gameState.scoreX > newScoreO ? "X" : newScoreO > gameState.scoreX ? "O" : null
              }

              // Mettre à jour l'état du jeu
              gameState = {
                ...gameState,
                flippedCards: [],
                matchedPairs: newMatchedPairs,
                scoreO: newScoreO,
                gameOver: isGameOver,
                winner: winner,
                isDraw: isGameOver && winner === null,
              }

              playSound("notification")
              updateMemoryBoardFromGameState()

              // Si le jeu est terminé
              if (isGameOver) {
                updateGameResult()
                if (winner === "O") {
                  playSound("lose")
                  stats.losses++
                  updateStats()
                  updateServerStats()
                  addGameToHistory(currentGame, "lose")
                }
                isProcessing = false
                return
              }

              // L'IA a trouvé une paire, elle rejoue
              isProcessing = false
              setTimeout(() => {
                makeMemoryAIMove()
              }, 500)
            }, 1000)
          }, 800)

          return
        }

        // En mode facile, l'IA a une chance d'oublier de mémoriser une carte
        if (difficulty === "facile" && Math.random() < 0.4) {
          // Ne pas mémoriser cette carte (simulation d'oubli)
        } else {
          // Mémoriser cette carte pour plus tard
          knownCards[emoji] = i
        }
      }
    }

    // Si on arrive ici, l'IA n'a pas trouvé de paire connue
    // Choisir une carte au hasard parmi celles non retournées
    const availableCards = []
    for (let i = 0; i < gameState.board.length; i++) {
      if (!gameState.matchedPairs.includes(i)) {
        availableCards.push(i)
      }
    }

    if (availableCards.length === 0) {
      isProcessing = false
      return
    }

    // Choisir la première carte au hasard
    firstCardIndex = availableCards[Math.floor(Math.random() * availableCards.length)]

    // Retourner la première carte
    gameState = {
      ...gameState,
      flippedCards: [firstCardIndex],
    }
    updateMemoryBoardFromGameState()
    playSound("move")

    // Choisir la deuxième carte au hasard (différente de la première)
    setTimeout(() => {
      const secondAvailableCards = availableCards.filter(
        (index) => index !== firstCardIndex && !gameState.matchedPairs.includes(index),
      )

      if (secondAvailableCards.length === 0) {
        isProcessing = false
        return
      }

      const secondCardIndex = secondAvailableCards[Math.floor(Math.random() * secondAvailableCards.length)]

      // Retourner la deuxième carte
      gameState = {
        ...gameState,
        flippedCards: [firstCardIndex, secondCardIndex],
      }
      updateMemoryBoardFromGameState()
      playSound("move")

      // Vérifier la correspondance après un délai
      setTimeout(() => {
        const firstCard = gameState.board[firstCardIndex]
        const secondCard = gameState.board[secondCardIndex]

        if (firstCard.emoji === secondCard.emoji) {
          // Les cartes correspondent
          const newMatchedPairs = [...gameState.matchedPairs, firstCardIndex, secondCardIndex]

          // Mettre à jour le score
          const newScoreO = gameState.scoreO + 1

          // Vérifier si toutes les paires ont été trouvées
          const isGameOver = newMatchedPairs.length === gameState.board.length
          let winner = null

          if (isGameOver) {
            winner = gameState.scoreX > newScoreO ? "X" : newScoreO > gameState.scoreX ? "O" : null
          }

          // Mettre à jour l'état du jeu
          gameState = {
            ...gameState,
            flippedCards: [],
            matchedPairs: newMatchedPairs,
            scoreO: newScoreO,
            gameOver: isGameOver,
            winner: winner,
            isDraw: isGameOver && winner === null,
          }

          playSound("notification")

          // Si le jeu est terminé
          if (isGameOver) {
            updateGameResult()
            if (winner === "O") {
              playSound("lose")
              stats.losses++
              updateStats()
              updateServerStats()
              addGameToHistory(currentGame, "lose")
            }
            isProcessing = false
            return
          }

          // L'IA a trouvé une paire, elle rejoue
          updateMemoryBoardFromGameState()
          isProcessing = false
          setTimeout(() => {
            makeMemoryAIMove()
          }, 500)
        } else {
          // Les cartes ne correspondent pas, c'est au tour du joueur
          gameState = {
            ...gameState,
            flippedCards: [],
            currentPlayer: "X",
          }
          updateMemoryBoardFromGameState()
          isProcessing = false
        }
      }, 1000)
    }, 800)
  }, 500)
}

function updateMemoryBoardFromGameState() {
  if (!gameState || !gameState.board) return

  const cards = document.querySelectorAll(".memory-card")

  cards.forEach((card, index) => {
    const cardInner = card.querySelector(".memory-card-inner")

    // Réinitialiser les classes
    card.className = "memory-card"

    // Appliquer les états appropriés
    if (gameState.matchedPairs.includes(index)) {
      card.classList.add("matched")
      cardInner.style.transform = "rotateY(180deg)"
    } else if (gameState.flippedCards.includes(index)) {
      cardInner.style.transform = "rotateY(180deg)"
    } else {
      cardInner.style.transform = "rotateY(0deg)"
    }
  })

  // Mettre à jour le score
  if (mode === "local" || mode === "solo") {
    document.getElementById("score-x").textContent = gameState.scoreX
    document.getElementById("score-o").textContent = gameState.scoreO

    // Afficher le scoreboard
    const scoreboard = document.getElementById("scoreboard")
    if (scoreboard) {
      scoreboard.style.display = "flex"
    }
  }

  updateCurrentPlayerInfo()

  // Mettre à jour le résultat si le jeu est terminé
  if (gameState.gameOver) {
    updateGameResult()
  }
}

function updateGameResult() {
  const gameResultEl = document.getElementById("game-result")
  if (!gameResultEl || !gameState.gameOver) return

  if (gameState.isDraw) {
    gameResultEl.textContent = "Match nul!"
    gameResultEl.className = "game-result draw"
    playSound("draw")
  } else if (gameState.winner) {
    if (mode === "solo") {
      if (gameState.winner === "X") {
        gameResultEl.textContent = "Vous avez gagné!"
        gameResultEl.className = "game-result win"
        playSound("win")
      } else {
        gameResultEl.textContent = "L'IA a gagné!"
        gameResultEl.className = "game-result lose"
        playSound("lose")
      }
    } else if (mode === "local") {
      gameResultEl.textContent = `Joueur ${gameState.winner} a gagné!`
      gameResultEl.className = `game-result player-${gameState.winner.toLowerCase()}-win`
      playSound("win")
    }
  }
}

function updateCurrentPlayerInfo() {
  const currentPlayerEl = document.getElementById("current-player")
  if (!currentPlayerEl) return

  if (gameState.gameOver) {
    currentPlayerEl.textContent = ""
    return
  }

  if (currentGame === "checkers") {
    // Spécifique au jeu Memory
    if (mode === "online") {
      if (waitingForOpponent) {
        currentPlayerEl.textContent = "En attente d'un adversaire..."
        currentPlayerEl.className = "game-status waiting"
      } else if (!onlineGameActive) {
        currentPlayerEl.textContent = "La partie n'a pas encore commencé"
        currentPlayerEl.className = "game-status waiting"
      } else {
        const isYourTurn = gameState.currentPlayer === playerSymbol
        currentPlayerEl.textContent = isYourTurn ? "C'est votre tour" : "Tour de l'adversaire"
        currentPlayerEl.className = isYourTurn ? "game-status your-turn" : "game-status opponent-turn"
      }
    } else if (mode === "solo") {
      if (gameState.currentPlayer === "O") {
        currentPlayerEl.textContent = "Tour de l'IA"
        currentPlayerEl.className = "game-status ai-turn"
      } else {
        currentPlayerEl.textContent = "Votre tour"
        currentPlayerEl.className = "game-status your-turn"
      }

      // Afficher le score actuel
      currentPlayerEl.textContent += ` - Score: Vous ${gameState.scoreX} | IA ${gameState.scoreO}`
    } else {
      currentPlayerEl.textContent = `Tour du joueur ${gameState.currentPlayer} - Score: X ${gameState.scoreX} | O ${gameState.scoreO}`
      currentPlayerEl.className = `game-status player-${gameState.currentPlayer.toLowerCase()}-turn`
    }
    return
  }

  // Code existant pour les autres jeux
  if (mode === "online") {
    if (waitingForOpponent) {
      currentPlayerEl.textContent = "En attente d'un adversaire..."
      currentPlayerEl.className = "game-status waiting"
    } else if (!onlineGameActive) {
      currentPlayerEl.textContent = "La partie n'a pas encore commencée"
      currentPlayerEl.className = "game-status waiting"
    } else {
      const isYourTurn = gameState.currentPlayer === playerSymbol
      currentPlayerEl.textContent = isYourTurn ? "C'est votre tour" : "Tour de l'adversaire"
      currentPlayerEl.className = isYourTurn ? "game-status your-turn" : "game-status opponent-turn"
    }
  } else if (mode === "solo" && gameState.currentPlayer === "O") {
    currentPlayerEl.textContent = "Tour de l'IA (O)"
    currentPlayerEl.className = "game-status ai-turn"
  } else {
    currentPlayerEl.textContent = `Tour du joueur ${gameState.currentPlayer}`
    currentPlayerEl.className = `game-status player-${gameState.currentPlayer.toLowerCase()}-turn`
  }
}

// Mettre à jour les tutoriels pour inclure Memory
function initializeTutorials() {
  tutorialSteps = {
    "tic-tac-toe": [
      {
        title: "Tic-Tac-Toe - Règles du jeu",
        content: `
          <p>Le Tic-Tac-Toe est un jeu simple où deux joueurs s'affrontent sur une grille de 3x3.</p>
          <p>Le but est d'aligner 3 symboles identiques horizontalement, verticalement ou en diagonale.</p>
        `,
      },
      {
        title: "Comment jouer",
        content: `
          <p>À tour de rôle, chaque joueur place son symbole (X ou O) dans une case vide.</p>
          <p>Le premier joueur utilise X, le second utilise O.</p>
          <p>Cliquez simplement sur une case vide pour y placer votre symbole.</p>
        `,
      },
      {
        title: "Modes de jeu",
        content: `
          <p><strong>Solo:</strong> Jouez contre l'IA avec différents niveaux de difficulté.</p>
          <p><strong>Local:</strong> Jouez à deux sur le même appareil.</p>
          <p><strong>En ligne:</strong> Affrontez d'autres joueurs en temps réel.</p>
        `,
      },
      {
        title: "Astuces",
        content: `
          <p>Le centre de la grille est souvent une position stratégique.</p>
          <p>Essayez de bloquer votre adversaire s'il a déjà aligné deux symboles.</p>
          <p>Créez des "fourches" en ayant deux possibilités d'alignement en même temps.</p>
        `,
      },
    ],
    "connect-four": [
      {
        title: "Connect Four - Règles du jeu",
        content: `
          <p>Connect Four est un jeu où deux joueurs font tomber des jetons dans une grille de 7x6.</p>
          <p>Le but est d'aligner 4 jetons de sa couleur horizontalement, verticalement ou en diagonale.</p>
        `,
      },
      {
        title: "Comment jouer",
        content: `
          <p>À tour de rôle, chaque joueur place un jeton dans une colonne.</p>
          <p>Le jeton tombe jusqu'à la position la plus basse disponible.</p>
          <p>Cliquez sur une colonne pour y placer votre jeton.</p>
        `,
      },
      {
        title: "Modes de jeu",
        content: `
          <p><strong>Solo:</strong> Jouez contre l'IA avec différents niveaux de difficulté.</p>
          <p><strong>Local:</strong> Jouez à deux sur le même appareil.</p>
          <p><strong>En ligne:</strong> Affrontez d'autres joueurs en temps réel.</p>
        `,
      },
      {
        title: "Astuces",
        content: `
          <p>Essayez de contrôler le centre de la grille.</p>
          <p>Faites attention aux alignements diagonaux, ils sont souvent moins visibles.</p>
          <p>Parfois, il est préférable de bloquer votre adversaire plutôt que de poursuivre votre propre stratégie.</p>
        `,
      },
    ],
    checkers: [
      {
        title: "Memory - Règles du jeu",
        content: `
          <p>Memory est un jeu de mémoire où vous devez retrouver des paires de cartes identiques.</p>
          <p>Le plateau contient des cartes face cachée, chacune ayant une carte jumelle avec le même symbole.</p>
        `,
      },
      {
        title: "Comment jouer",
        content: `
          <p>À chaque tour, retournez deux cartes en cliquant dessus.</p>
          <p>Si les deux cartes ont le même symbole, vous marquez un point et rejouez.</p>
          <p>Si les symboles sont différents, les cartes sont retournées face cachée et c'est au tour de l'adversaire.</p>
        `,
      },
      {
        title: "Modes de jeu",
        content: `
          <p><strong>Solo:</strong> Jouez contre l'IA.</p>
          <p><strong>Local:</strong> Jouez à deux sur le même appareil.</p>
          <p><strong>En ligne:</strong> Affrontez d'autres joueurs en temps réel.</p>
        `,
      },
      {
        title: "Fin de partie",
        content: `
          <p>La partie se termine lorsque toutes les paires ont été trouvées.</p>
          <p>Le joueur avec le plus de paires gagne la partie.</p>
          <p>En cas d'égalité, la partie est déclarée nulle.</p>
        `,
      },
    ],
  }
}

// Ajouter des styles CSS pour le jeu Memory
document.addEventListener("DOMContentLoaded", () => {
  const styleElement = document.createElement("style")
  styleElement.textContent = `
    .memory-board {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      grid-gap: 10px;
      max-width: 500px;
      margin: 0 auto;
    }
    
    .memory-card {
      aspect-ratio: 1;
      perspective: 1000px;
      cursor: pointer;
    }
    
    .memory-card-inner {
      position: relative;
      width: 100%;
      height: 100%;
      text-align: center;
      transition: transform 0.6s;
      transform-style: preserve-3d;
    }
    
    .memory-card-front, .memory-card-back {
      position: absolute;
      width: 100%;
      height: 100%;
      backface-visibility: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
      font-size: 2rem;
    }
    
    .memory-card-front {
      background-color: var(--primary);
      color: white;
    }
    
    .memory-card-back {
      background-color: var(--card-bg);
      transform: rotateY(180deg);
    }
    
    .memory-card.matched .memory-card-back {
      background-color: var(--success);
      animation: pulse 1.5s infinite ease-in-out;
    }
    
    @media (max-width: 500px) {
`
  document.head.appendChild(styleElement)
})

function playRPS(playerChoice) {
  const choices = ['rock', 'paper', 'scissors'];
  const computerChoice = choices[Math.floor(Math.random() * choices.length)];

  let resultMessage = `You chose ${playerChoice.toUpperCase()} — Computer chose ${computerChoice.toUpperCase()}. `;

  if (playerChoice === computerChoice) {
    resultMessage += "It's a draw!";
  } else if (
    (playerChoice === 'rock' && computerChoice === 'scissors') ||
    (playerChoice === 'paper' && computerChoice === 'rock') ||
    (playerChoice === 'scissors' && computerChoice === 'paper')
  ) {
    resultMessage += "You win! 🎉";
  } else {
    resultMessage += "You lose! 😢";
  }

  document.getElementById('rps-result').innerText = resultMessage;
}
// ========== Rock Paper Scissors Game ==========
const choices = ["rock", "paper", "scissors"];
const rpsButtons = document.querySelectorAll(".rps-btn");
const rpsResult = document.getElementById("rps-result");
const rpsStatus = document.getElementById("rps-status");
const rpsUserChoice = document.getElementById("rps-user-choice");
const rpsCpuChoice = document.getElementById("rps-cpu-choice");

rpsButtons.forEach(button => {
  button.addEventListener("click", () => {
    const userChoice = button.getAttribute("data-choice");
    const cpuChoice = choices[Math.floor(Math.random() * 3)];

    // Display choices
    rpsUserChoice.textContent = formatHand(userChoice);
    rpsCpuChoice.textContent = formatHand(cpuChoice);

    // Determine result
    const result = getRpsResult(userChoice, cpuChoice);
    rpsResult.textContent = result;

    // Update status visually
    rpsStatus.className = "rps-status";
    rpsStatus.classList.add(result.toLowerCase());
  });
});

function formatHand(choice) {
  if (choice === "rock") return "✊";
  if (choice === "paper") return "✋";
  if (choice === "scissors") return "✌️";
  return "?";
}

function getRpsResult(player, cpu) {
  if (player === cpu) return "Draw";
  if (
    (player === "rock" && cpu === "scissors") ||
    (player === "paper" && cpu === "rock") ||
    (player === "scissors" && cpu === "paper")
  ) {
    return "Win";
  }
  return "Lose";
}
