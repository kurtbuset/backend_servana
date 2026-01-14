const {verifyAccessToken} = require('../utils/jwt');

module.exports = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer'))
        return res.status(401).json({ message: 'Unauthorized' });

    try {
        const token = authHeader.split('')[1];
        const decoded = verifyAccessToken(token);
        req.user = decoded;
        next();
    } catch {
        return res.status(401).json({ message: 'Invalid or expired token' });
    }
}