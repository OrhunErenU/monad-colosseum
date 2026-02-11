# 🔥 Monad Colosseum - OPUS 4.6 PROMPTS

## 📁 AÇILACAK DOSYALAR (Sırayla)

| # | Dosya | Komut |
|---|-------|-------|
| 1 | `contracts/GladiatorFactory.sol` | Ctrl+P → GladiatorFactory.sol |
| 2 | `backend/package.json` | Ctrl+P → package.json |
| 3 | `backend/server.js` | Ctrl+P → server.js |
| 4 | `frontend/src/components/Skeleton.jsx` | **YENİ** oluştur |
| 5 | `frontend/src/components/ErrorBoundary.jsx` | **YENİ** oluştur |

---

## 🔥 PROMPT 1: Smart Contract Security

**Aç:** `contracts/GladiatorFactory.sol`

```
# Smart Contract Security Upgrade

Bu Solidity dosyasına şunları ekle:

1. DOSYA BAŞI - Import'lar:
```solidity
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
```

2. CONTRACT DEKLARASYON:
Değiştir: `contract GladiatorFactory is ERC721URIStorage {`
Şuna: `contract GladiatorFactory is ERC721URIStorage, ReentrancyGuard, Pausable, AccessControl {`

3. CONSTRUCTOR İÇİNE:
```solidity
// Role definitions
bytes32 constant ARENA_ADMIN = keccak256("ARENA_ADMIN");
bytes32 constant EMERGENCY_OPERATOR = keccak256("EMERGENCY_OPERATOR");

// Grant roles
_grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
_grantRole(ARENA_ADMIN, msg.sender);
_grantRole(EMERGENCY_OPERATOR, msg.sender);
```

4. PAUSE/UNPAUSE FONKSİYONLARI EKLE:
```solidity
function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
    _pause();
}

function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
    _unpause();
}
```

5. FONKSİYONLARA:
- `createGladiator` ve `joinArena` → `nonReentrant` modifier ekle
- Tüm public fonksiyonlara → Natspec comments (@title, @notice, @dev) ekle
```

---

## 🔥 PROMPT 2: Backend Dependencies

**Aç:** `backend/package.json`

```
# Backend Dependencies

`dependencies`'a ekle:
```json
"express-rate-limit": "^7.1.0",
"helmet": "^7.1.0"
```

Sonra terminalde çalıştır: `cd backend && npm install`
```

---

## 🔥 PROMPT 3: Backend Rate Limiting

**Aç:** `backend/server.js`

```
# Backend Rate Limiting & Security

Require'ların altına ekle:
```javascript
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
```

app.use'ların altına ekle:
```javascript
// Security headers
app.use(helmet());

// Rate limiters
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Çok fazla istek, lütfen daha sonra deneyin.' },
  standardHeaders: true,
  legacyHeaders: false
});

const agentLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Rate limit aşıldı.' }
});

app.use('/api/', apiLimiter);
app.use('/api/v1/external/', agentLimiter);

// Request logging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});
```
```

---

## 🔥 PROMPT 4: Frontend Skeleton

**Oluştur:** `frontend/src/components/Skeleton.jsx`

```
# Frontend Skeleton Loading Component

Bu dosyayı oluştur:

```jsx
export function SkeletonCard({ width = '100%', height = '120px' }) {
  return (
    <div 
      style={{
        width,
        height,
        background: 'linear-gradient(90deg, var(--bg-tertiary) 25%, var(--bg-secondary) 50%, var(--bg-tertiary) 75%)',
        backgroundSize: '200% 100%',
        animation: 'shimmer 1.5s infinite',
        borderRadius: '12px'
      }}
    />
  );
}

export function SkeletonList({ count = 5 }) {
  return (
    <div>
      {[...Array(count)].map((_, i) => (
        <SkeletonCard key={i} height="80px" style={{ marginBottom: '0.5rem' }} />
      ))}
    </div>
  );
}
```

CSS'e ekle:
```css
@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
```

Kullanım:
```jsx
{isLoading ? <SkeletonCard /> : <GladiatorCard data={data} />}
```
```

---

## 🔥 PROMPT 5: Frontend Error Boundary

**Oluştur:** `frontend/src/components/ErrorBoundary.jsx`

```
# React Error Boundary Component

Bu dosyayı oluştur:

```jsx
import React from 'react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Error caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '2rem', textAlign: 'center', background: 'var(--bg-tertiary)', borderRadius: '12px' }}>
          <h2 style={{ color: 'var(--accent-danger)' }}>😔 Bir hata oluştu</h2>
          <p style={{ color: 'var(--text-secondary)' }}>{this.state.error?.message}</p>
          <button onClick={() => window.location.reload()} style={{ padding: '0.75rem 1.5rem', background: 'var(--accent-primary)', border: 'none', borderRadius: '8px', color: 'white', cursor: 'pointer' }}>
            🔄 Sayfayı Yenile
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
```

Kullanım:
```jsx
<ErrorBoundary>
  <MyComponent />
</ErrorBoundary>
```
```

---

## ✅ YAPILACAKLAR

| # | Dosya | Status |
|---|-------|--------|
| 1 | `contracts/GladiatorFactory.sol` | ⬜ |
| 2 | `backend/package.json` + npm install | ⬜ |
| 3 | `backend/server.js` | ⬜ |
| 4 | `frontend/src/components/Skeleton.jsx` | ⬜ |
| 5 | `frontend/src/components/ErrorBoundary.jsx` | ⬜ |

**Sıra:** 1 → 2 → 3 → 4 → 5

---

## 🚨 OLASI HATALAR & ÇÖZÜMLERİ

### Hata 1: "Import not found"
```
Çözüm: OpenZeppelin kurulu değil. Çalıştır:
cd monad-colosseum && npm install @openzeppelin/contracts
```

### Hata 2: "rateLimit is not a function"
```
Çözüm: express-rate-limit yanlış import.
Doğru: const rateLimit = require('express-rate-limit');
```

### Hata 3: "helmet is not defined"
```
Çözüm: helmet import unutulmuş. server.js başına ekle:
const helmet = require('helmet');
```

### Hata 4: "nonReentrant modifier not found"
```
Çözüm: Contract inheritance'e ReentrancyGuard ekle.
Şunu kontrol et: "is ERC721URIStorage, ReentrancyGuard"
```

### Hata 5: "Animation shimmer not found"
```
Çözüm: CSS dosyasına @keyframes shimmer ekle.
```

### Hata 6: "ErrorBoundary loop"
```
Çözüm: ErrorBoundary içinde kendini çağırma.
Sadece this.props.children'ı render et.
```

### Hata 7: "Contract compilation failed"
```
Çözüm: Natspec comments // yerine /** */ olmalı.
Doğru: /// @title ...
```

---

## 🔧 HATA ALIRSAN

1. Hatayı kopyala
2. OPUS_PROMPTS.md dosyasındaki "Olası Hatalar" bölümüne bak
3. Bulamazsan: "HATA: [hatayı yaz] - OPUS'a sor" diye sor
