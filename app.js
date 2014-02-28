var restify = require('restify');
var mongojs = require('mongojs');
var _ = require('underscore');

var ip = '54.84.241.29';
var port = '8081';

var server = restify.createServer({
  name:'restplatform'
});

server.use(restify.queryParser());
server.use(restify.bodyParser());
server.use(restify.CORS());

var mongoConnection = '127.0.0.1:27017/smartplaces';
var db = mongojs(mongoConnection,['smartplaces']);
var beacons = db.collection('beacons');
var scenarios = db.collection('scenarios');
var messages = db.collection('messages');
var requests = db.collection('requests');

server.get({path:'/messagefor/:uuid/:major/:minor/:proximity/:event',version:'0.0.1'}, messageFor);

server.listen(port,ip,function(){
  console.log('%s listening at %s',server,port);
});

function messageFor(req, res, next){
  res.setHeader('Access-Control-Allow-Origin','*');
  beacons.findOne({uuid:req.params.uuid,major:req.params.major,minor:req.params.minor},function (err,beacon){
    if (err){
      return next(err);
    }
    if (beacon){
      scenarios.findOne({
        beacons:{$in:beacon.tags},
        active:true,
        proximity:req.params.proximity,
        event:req.params.event,
        start:{$lte:new Date()},
        end:{$gte:new Date()}
      },function(err,scenario){
        if (err){
          return next(err);
        }

        if (scenario){
          messages.findOne({_id:scenario.message},function(err,message){
            if (err){
              return next(err);
            }
            if (message){
              res.send(200,_.pick(message,'text','url'));
              var log = {
                ts: new Date().getTime(),
                proximity: req.params.proximity,
                event: req.params.event
              }
              _.extend(log,_.pick(beacon,'uuid','major','minor'));
              _.extend(log,_.pick(message,'text','url'));
              requests.insert(log,function(err,success){
                if (err){
                  console.log(err);
                }
              });
              return next();
            }else{
              res.send(200, {error:'message not found'});
              return next();
            }
          });
        }else{
          res.send(200, {error:'scenario not found'});
          return next();
        }
      });
    }else{
      res.send(200, {error:'beacon not found'});
      return next();
    }
  });
}