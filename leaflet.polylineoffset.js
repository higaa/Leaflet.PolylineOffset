(function (factory, window) {
    if (typeof define === 'function' && define.amd) {
        define(['leaflet'], factory);
    } else if (typeof exports === 'object') {
        module.exports = factory(require('leaflet'));
    }
    if (typeof window !== 'undefined' && window.L) {
        window.L.PolylineOffset = factory(L);
    }
}(function (L) {

function forEachPair(list, callback) {
    if (!list || list.length < 1) { return; }
    for (var i = 1, l = list.length; i < l; i++) {
        callback(list[i-1], list[i]);
    }
}

/**
Find the coefficients (a,b) of a line of equation y = a.x + b,
or the constant x for vertical lines
Return null if there's no equation possible
*/
function lineEquation(pt1, pt2) {
    if (pt1.x === pt2.x) {
        return pt1.y === pt2.y ? null : { x: pt1.x };
    }

    var a = (pt2.y - pt1.y) / (pt2.x - pt1.x);
    return {
        a: a,
        b: pt1.y - a * pt1.x,
    };
}

/**
Return the intersection point of two lines defined by two points each
Return null when there's no unique intersection
*/
function intersection(l1a, l1b, l2a, l2b) {
    var line1 = lineEquation(l1a, l1b);
    var line2 = lineEquation(l2a, l2b);

    if (line1 === null || line2 === null) {
        return null;
    }

    if (line1.hasOwnProperty('x')) {
        return line2.hasOwnProperty('x')
            ? null
            : {
                x: line1.x,
                y: line2.a * line1.x + line2.b,
            };
    }
    if (line2.hasOwnProperty('x')) {
        return {
            x: line2.x,
            y: line1.a * line2.x + line1.b,
        };
    }

    if (line1.a === line2.a) {
        return null;
    }

    var x = (line2.b - line1.b) / (line1.a - line2.a);
    return {
        x: x,
        y: line1.a * x + line1.b,
    };
}
function signedArea(p1, p2, p3) {
    return (p2.x - p1.x) * (p3.y - p1.y) - (p3.x - p1.x) * (p2.y - p1.y);
}
function intersects(l1a, l1b, l2a, l2b) {
    return signedArea(l1a, l1b, l2a) * signedArea(l1a, l1b, l2b) < 0 &&
        signedArea(l2a, l2b, l1a) * signedArea(l2a, l2b, l1b) < 0;
}

function translatePoint(pt, dist, heading) {
    return {
        x: pt.x + dist * Math.cos(heading),
        y: pt.y + dist * Math.sin(heading),
    };
}

var PolylineOffset = {
    offsetPointLine: function(points, distance) {
        var offsetSegments = [];

        forEachPair(points, L.bind(function(a, b) {
            if (a.x === b.x && a.y === b.y) { return; }

            // angles in (-PI, PI]
            var segmentAngle = Math.atan2(a.y - b.y, a.x - b.x);
            var offsetAngle = segmentAngle - Math.PI/2;

            offsetSegments.push({
                offsetAngle: offsetAngle,
                original: [a, b],
                offset: [
                    translatePoint(a, distance, offsetAngle),
                    translatePoint(b, distance, offsetAngle)
                ]
            });
        }, this));

        return offsetSegments;
    },

    offsetPoints: function(pts, options) {
        var offsetSegments = this.offsetPointLine(L.LineUtil.simplify(pts, options.smoothFactor), options.offset);
        return this.joinLineSegments(offsetSegments, options.offset);
    },

    /**
    Join 2 line segments defined by 2 points each with a circular arc
    */
    joinSegments: function(s1, s2, offset) {
        // TODO: different join styles
        return this.circularArc(s1, s2, offset)
            .filter(function(x) { return x; })
    },

    joinOuterAngles: function(s1, s2, offset) {
        // TODO: different join styles
        return this.circularArc(s1, s2, offset)
            .filter(function(x) { return x; })
    },

    joinLineSegments: function(segments, offset) {
        var offsetSegments = [];
        var joinedPoints = [];
        var first = segments[0];
        var last = segments[segments.length - 1];

        if (first && last) {
            offsetSegments.push(segments[0].offset);
            forEachPair(segments, L.bind(function(s1, s2) {
                offsetSegments = offsetSegments.concat(this.joinOuterAngles(s1, s2, offset));
                offsetSegments.push(s2.offset);
            }, this));
            joinedPoints = this.cutInnerAngles(offsetSegments);
        }

        return joinedPoints;
    },

    segmentAsVector: function(s) {
        return {
            x: s[1].x - s[0].x,
            y: s[1].y - s[0].y,
        };
    },

    getSignedAngle: function(s1, s2) {
        const a = this.segmentAsVector(s1);
        const b = this.segmentAsVector(s2);
        return Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y);
    },

    /**
    Interpolates points between two offset segments in a circular form
    */
    circularArc: function(s1, s2, distance) {
        // if the segments are the same angle,
        // there should be a single join point
        if (s1.offsetAngle === s2.offsetAngle) {
            return [];
        }

        const signedAngle = this.getSignedAngle(s1.offset, s2.offset);
        // for inner angles, just find the offset segments intersection
        if (signedAngle * distance > 0) {
            return [];
        }

        // draws a circular arc with R = offset distance, C = original meeting point
        var points = [];
        var center = s1.original[1];
        // ensure angles go in the anti-clockwise direction
        var rightOffset = distance > 0;
        var startAngle = rightOffset ? s2.offsetAngle : s1.offsetAngle;
        var endAngle = rightOffset ? s1.offsetAngle : s2.offsetAngle;
        // and that the end angle is bigger than the start angle
        if (endAngle < startAngle) {
            endAngle += Math.PI * 2;
        }
        var step = Math.PI / 8;
        points.push(rightOffset ? s2.offset[0] : s1.offset[1]);
        for (var alpha = startAngle + step; alpha < endAngle; alpha += step) {
            points.push(translatePoint(center, distance, alpha));
        }
        points.push(rightOffset ? s1.offset[1] : s2.offset[0]);

        points = (rightOffset ? points.reverse() : points);

        var offsetSegments = [];
        forEachPair(points, L.bind(function(p1, p2) {
            offsetSegments.push([p1, p2]);
        }, this));
        return offsetSegments;
    },

    cutInnerAngles: function(segments) {
        var i = 0;
        while (true) {
            if (i + 1 >= segments.length) {
                break;
            }
            if (segments[i][1] == segments[i+1][0]) {
                ++i;
                continue;
            }
            var j = i;
            while (true) {
                if (intersects(segments[j][0], segments[j][1], segments[i+1][0], segments[i+1][1])) {
                    p = intersection(segments[j][0], segments[j][1], segments[i+1][0], segments[i+1][1]);
                    segments[j][1] = p;
                    segments[i+1][0] = p;
                    if (j < i) {
                        segments.splice(j + 1, i - j);
                    }
                    i = j + 1;
                    break;
                }
                if (j == 0) {
                    segments.splice(i + 1, 1);
                    ++i;
                    break;
                }
                --j;

            }
        }

        var points = [];
        points.push(segments[0][0]);
        for (var i1 = 0; i1 < segments.length; ++i1) {
            points.push(segments[i1][1])
        }

        return points;
    }

}

// Modify the L.Polyline class by overwriting the projection function
L.Polyline.include({
    _projectLatlngs: function (latlngs, result, projectedBounds) {
        var isFlat = latlngs.length > 0 && latlngs[0] instanceof L.LatLng;

        if (isFlat) {
            var ring = latlngs.map(L.bind(function(ll) {
                var point = this._map.latLngToLayerPoint(ll);
                if (projectedBounds) {
                    projectedBounds.extend(point);
                }
                return point;
            }, this));

            // Offset management hack ---
            if (this.options.offset) {
                ring = L.PolylineOffset.offsetPoints(ring, this.options);
            }
            // Offset management hack END ---

            result.push(ring.map(function (xy) {
                    return L.point(xy.x, xy.y);
                }));
        } else {
            latlngs.forEach(L.bind(function(ll) {
                this._projectLatlngs(ll, result, projectedBounds);
            }, this));
        }
    }
});

L.Polyline.include({
    setOffset: function(offset) {
        this.options.offset = offset;
        this.redraw();
        return this;
    }
});

return PolylineOffset;

}, window));
