import jwt from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET || JWT_ACCESS_SECRET; // Use env var for security

export const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization

  if (!authHeader || !authHeader.startsWith('Bearer')) {
    return res.status(401).json({ message: 'No token provided'})
  }

  const token = authHeader.split(' ')[1]

  try {
    const decoded = jwt.verify(token, JWT_SECRET) // use the same secret as in auth.js
    req.user = decoded
    next()
  } catch (err) {
    return res.status(403).json({ message: 'Invalid token'})
  }
}
