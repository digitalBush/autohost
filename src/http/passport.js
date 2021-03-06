var _ = require( 'lodash' );
var when = require( 'when' );
var passport = require( 'passport' );
var debug = require( 'debug' )( 'autohost:passport' );
var noOp = function() { return when( true ); };
var userCountCheck = noOp;
var authorizationErrorCount = 'autohost.authorization.errors';
var authorizationErrorRate = 'autohost.authorization.error.rate';
var authenticationTimer = 'autohost.authentication.timer';
var authorizationTimer = 'autohost.authorization.timer';
var passportInitialize = passport.initialize();
var passportSession = passport.session();
var authProvider;
var anonPaths;
var metrics;

function addPassport( http ) {
	http.middleware( '/', passportInitialize );
	http.middleware( '/', passportSession );
	
	_.each( anonPaths, function( pattern ) {
		http.middleware( pattern, skipAuthentication );
	} );
	
	http.middleware( '/', whenNoUsers );
	http.middleware( '/', authConditionally );
	http.middleware( '/', getRoles );

	passport.serializeUser( authProvider.serializeUser );
	passport.deserializeUser( authProvider.deserializeUser );
	debug( 'passport configured' );
}

function authConditionally( req, res, next ) {
	// if previous middleware has said to skip auth OR
	// a user was attached from a session, skip authenticating
	if( req.skipAuth || ( req.user && req.user.name ) ) {
		next();
	} else {
		metrics.timer( authenticationTimer ).start();
		authProvider.authenticate( req, res, next );
		metrics.timer( authenticationTimer ).record();
	}
}

function getAuthMiddleware( uri ) {
	var list = [
		{ path: uri, fn: passportInitialize },
		{ path: uri, fn: passportSession }
	]
	.concat( _.map( anonPaths, function( pattern ) {
		return { path: pattern, fn: skipAuthentication };
	} ) )
	.concat( [ { path: uri, fn: whenNoUsers },
			   { path: uri, fn: authConditionally },
			   { path: uri, fn: getRoles } ] );
	return list;
}

function getRoles( req, res, next ) {
	var userName = _.isObject( req.user.name ) ? req.user.name.name : req.user.name;
	if( userName === 'anonymous' ) {
		req.user.roles = [ 'anonymous' ];
		next();
	} else {
		metrics.timer( authorizationTimer ).start();
		authProvider.getUserRoles( req.user.name )
			.then( null, function( err ) {
				metrics.counter( authorizationErrorCount ).incr();
				metrics.meter( authorizationErrorRate ).record();
				metrics.timer( authorizationTimer ).record();
				debug( 'Failed to get roles for %s with %s', userName, err.stack );
				res.status( 500 ).send( 'Could not determine user permissions' );
			} )
			.then( function( roles ) {
				debug( 'Got roles [ %s ] for %s', roles, req.user.name );
				req.user.roles = roles;
				metrics.timer( authorizationTimer ).record();
				next();
			} );
	}
}

function getSocketRoles( userName ) {
	if( userName === 'anonymous' ) {
		return when( [ 'anonymous' ] );
	} else {
		metrics.timer( authorizationTimer ).start();
		return authProvider.getUserRoles( userName )
			.then( null, function( err ) {
				metrics.counter( authorizationErrorCount ).incr();
				metrics.meter( authorizationErrorRate ).record();
				metrics.timer( authorizationTimer ).record();
				debug( 'Failed to get roles for %s with %s', userName, err.stack );
				return [];
			} )
			.then( function( roles ) {
				debug( 'Got roles [ %s ] for %s', roles, userName );
				metrics.timer( authorizationTimer ).record();
				return roles;
			} );
	}
}

function resetUserCount() {
	userCountCheck = authProvider.hasUsers;
}

function skipAuthentication( req, res, next ) {
	req.skipAuth = true;
	req.user = {
		id: 'anonymous',
		name: 'anonymous',
		roles: []
	};
	debug( 'Skipping authentication and assigning user anonymous to request %s %s', req.method, req.url );
	next();
}

function whenNoUsers( req, res, next ) {
	userCountCheck()
		.then( function( hasUsers ) {
			if( hasUsers ) {
				userCountCheck = noOp;
				next();
			} else {
				skipAuthentication( req, res, next );
			}
		} );
}

function withAuthLib( authProvider ) {
	userCountCheck = authProvider.hasUsers || userCountCheck;
	_.each( authProvider.strategies, function( strategy ) {
		passport.use( strategy );
	} );
}

module.exports = function( config, authPlugin, meter ) {
	metrics = meter;
	authProvider = authPlugin;
	authProvider.initPassport( passport );
	if( config.anonymous ) {
		anonPaths = _.isArray( config.anonymous ) ? config.anonymous : [ config.anonymous ];
	} else {
		anonPaths = [];
	}
	withAuthLib( authProvider );
	return {
		getMiddleware: getAuthMiddleware,
		getSocketRoles: getSocketRoles,
		hasUsers: userCountCheck,
		resetUserCheck: resetUserCount,
		wireupPassport: addPassport
	};
};