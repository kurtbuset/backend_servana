const jwt = require("jsonwebtoken");
const config = require('../config/app');

const jwtAccessSecret = config.jwt.accessSecret;
const jwtRefreshSecret = config.jwt.refreshSecret;
const accessTokenExpiry = config.jwt.accessExpiry;
const refreshTokenExpiry = config.jwt.refreshExpiry;

exports.generateAccessToken = (payload) => {
    return jwt.sign(payload, jwtAccessSecret, { algorithm: 'HS256', expiresIn: accessTokenExpiry });
};

exports.generateRefreshToken = (payload) => {
    return jwt.sign(payload, jwtRefreshSecret, { algorithm: 'HS256', expiresIn: refreshTokenExpiry });
};

exports.verifyAccessToken = (token) => {
    return jwt.verify(token, jwtAccessSecret, { algorithms: ['HS256'] });
};

exports.verifyRefreshToken = (token) => {
    return jwt.verify(token, jwtRefreshSecret, { algorithms: ['HS256'] });
};
