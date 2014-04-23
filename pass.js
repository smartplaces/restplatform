var restify = require('restify');
var _ = require('underscore');
var fs = require('fs');
var mongojs = require('mongojs');

var mongoConnection = 'localhost/smartplaces';
var db = mongojs(mongoConnection,['smartplaces']);
var passes = db.collection('passes');

var http_port = '80';
var https_port = '443';

var http_server = restify.createServer({
  name:'http_restplatform'
});

var https_server = restify.createServer({
  name:'https_restplatform',
  key: fs.readFileSync('/home/ubuntu/ssl/server.key'),
  certificate: fs.readFileSync('/home/ubuntu/ssl/server.crt')
});

initServer(http_server);
initServer(https_server);

http_server.listen(http_port,function(){
  console.log('%s listening at %s',http_server.name,http_server.url);
});

https_server.listen(https_port,function(){
  console.log('%s listening at %s',https_server.name,https_server.url);
});


function initServer(server){

  server.use(restify.acceptParser(server.acceptable));
  server.use(restify.authorizationParser());
  server.use(restify.dateParser());
  server.use(restify.queryParser());
  server.use(restify.jsonp());
  server.use(restify.gzipResponse());
  server.use(restify.bodyParser());


  server.get({path:'/passws/'},function (req, res, next){
    console.log('Handling index request...');
    res.send(200,{ok:1});
    return next();
  });

  server.post({path:'/passws/v1/devices/:device_id/registrations/:pass_type_id/:serial_number'},function (req, res, next){
    var authToken = req.header('Authorization');
    var serialNumber = req.params.serial_number;
    var passType = req.params.pass_type_id;
    var deviceId = req.params.device_id;
    var pushToken = req.params.pushToken;

    passes.findOne({passType:passType,serialNumber:serialNumber,authToken:authToken}, function (err,pass){
      if (pass){
        if (_.indexOf(pass.registrations,deviceId) > -1){
          res.status(200);
          return next();
        }else{
          passes.update({_id:pass._id},{$addToSet:{registrations:{deviceId:deviceId,pushToken:pushToken}}},{},function(err){
              if (err){
                res.status(500);
                return next();
              }else{
                res.status(201);
                return next();
              }
          });
        }
      }else{
        res.status(401);
        return next();
      }
    });
    /*
    console.log('Handling registration request...');
    console.log("#<RegistrationRequest device_id: " + req.params.device_id +
      ", pass_type_id: " + req.params.pass_type_id +
      ", serial_number: " + req.params.serial_number +
      ", authentication_token: " + req.header('Authorization') +
      ", push_token: " + req.params.pushToken+">");
    res.status(200);
    */
    return next();

  });

  server.get({path:'/passws/v1/devices/:device_id/registrations/:pass_type_id?'},function (req, res, next){
    console.log('Handling updates request...');
    res.status(204);
    return next();
  });

  server.del({path:'/passws/v1/devices/:device_id/registrations/:pass_type_id/:serial_number'},function (req, res, next){
    console.log('Handling unregistration request...')
    res.status(200);
    return next();
  });

  server.get({path:'/passws/v1/passes/:pass_type_id/:serial_number'},function (req, res, next){
    console.log('Handling pass delivery request...');
    res.status(401);
    return next();
  });

  server.post({path:'passws/v1/log'},function (req, res, next){
    console.log('Handling log request...');
    console.log('#<LogRequest logs: '+req.params.logs+">");
    res.status(200);
    return next();
  });
}
