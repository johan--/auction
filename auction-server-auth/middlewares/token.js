var _ = require('underscore');
var moment = require('moment');
var jwt = require('json-web-token');            // https://www.npmjs.com/package/json-web-token
var User = require('../models/User');
var config = require('config');

module.exports = function (auditLog,logger) {

    return {

        /**
         Encode JWT token
         params as list of params to encode
         type is refresh, access, service
         **/
        tokenEncode: function (params, cb) {
            currDate = new Date();
            expDate = new Date();

            if (!_.contains(['refresh', 'access','service'], params.type)) {                      // check type of token is refresh, auth or service
                params.type = 'refresh';
            }
            var payload = {
                "iss": params.issuer,
                "iat": moment(currDate).unix(),
                "sub": params.userid,
                "type": params.type,
                "rti" : params.refreshToken,
                "ip" : params.ip
            };
            if (params.expires!=0) {
                expDate.setMinutes(currDate.getMinutes() + parseInt(params.expires));
                payload.exp=moment(expDate).unix();
            }

            jwt.encode(params.secret, payload, function (err, token) {
                if (err) {
                    return cb(err);
                } else {
                    return cb(null, token);
                }
            });
        },

        /*
         * Decode a JWT token
         * 
         */
        tokenDecode: function (token, secret, cb) {
            jwt.decode(secret, token, function (err, decode) {
                if (err) {
                    return cb(err);
                } else {
                    return cb(null, decode);
                }
            });
        },

        /*
        * Generates a random token
        */

        // TODO : Make this more secure

        randomToken: function(length,cb) {
            var token = "";
            var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
            for(var i = 0; i < length; i++) {
                token += possible.charAt(Math.floor(Math.random() * possible.length));
            }
            return cb(token);
        },
        
        /**
         * extracts token from web request
         */
        getToken: function fromHeaderOrQuerystring(req) {
            if (req.headers.authorization && req.headers.authorization.split(' ')[0] === 'Bearer') {
                return req.headers.authorization.split(' ')[1];
            } else if (req.query && req.query.token) {
                return req.query.token;
            }
            return null;
        },

        /**
         * Returns secret key using issuer from token
         */
        secretCallback: function (req, payload, done) {
            secret = null;
            if (payload) {
                if (payload.type == 'refresh') {
                    secret = config.tokens.refresh.secret;
                } else if (payload.type == 'auth') {
                    secret = config.tokens.access.secret;
                }
                return done(null, secret);
            }
            return done('invalid token', null);
        },

        /*
        * isRevokedCallback
        * Checks token payload for a valid:
        *       sub = users id against db
        *       rti = users fresh token in db
        *       ip = users lastIp in db
        *       also checks the user account is active
        */
        isRevokedCallback: function (req, payload, done) {

            if (payload) {
                var tokenUserId = payload.sub;
                var tokenId = payload.rti;
                var tokenIp = payload.ip;
                var ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

                User.findById(tokenUserId).exec(function (err, user) {
                    if (err) {
                        return done(err);
                    }

                    /*
                    * Begin token validation
                    */

                    if (config.tokens.refresh.enforce_valid_ip) {
                        if (tokenIp != ip) {
                            // ip enforcement on and tokens ip != users.lastIp
                            auditLog.info("User %s failed authentication with token. Tokens ip does not match users last ip",tokenUserId,{id:tokenUserId,email:'',ip:req.headers['x-forwarded-for'] || req.connection.remoteAddress,msg_id:300});
                            return done(null, true);
                        }
                    }
                    if (!user) {
                        // we dont have a valid user
                        return done(null, true);
                    }
                    if (!user.accountActive) {
                        // user account is inactive
                        auditLog.info("User %s failed authentication with token. User account is inactive",tokenUserId,{id:tokenUserId,email:'',ip:req.headers['x-forwarded-for'] || req.connection.remoteAddress,msg_id:300});
                        return done(null, true);
                    }
                    if (tokenId != user.refreshToken) {
                        // users refreshToken != tokens refresh token id
                        auditLog.info("User %s failed authentication with token. Tokens id does not match users token id",tokenUserId,{id:tokenUserId,email:'',ip:req.headers['x-forwarded-for'] || req.connection.remoteAddress,msg_id:300});
                        return done(null, true);
                    }
                    // user ok and token ok
                    return done(null, false);
                });
            } else {
                // something went wrong, we dont have a token payload so return 401
                return done(null, true);
            }
        }
    };
};